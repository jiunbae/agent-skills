#!/usr/bin/env python3
"""Deterministic host-side safety primitives for the RPF skill.

This module deliberately returns metadata, never inspected secret values.  It is
small enough to audit and uses only the Python standard library so a host can
run it before any repository bytes enter an agent context.
"""

from __future__ import annotations

import argparse
import copy
import ctypes
import dataclasses
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping, Sequence


PROTOCOL_VERSION = "rpf-child-v1"
FULL_MODE = "full"
AUDIT_MODE = "audit"
GAME_FAMILIES = (
    "lifecycle",
    "scenes",
    "assets",
    "input",
    "state",
    "physics/AI",
    "combat",
    "economy/progression",
    "save/load",
    "network",
    "UI",
    "platform variants",
)
INCIDENT_FAMILIES = (
    "state-file-corruption-overwrite",
    "email-only-auth-default",
    "session-teardown-concurrency-loss",
    "chat-final-save-truthfulness",
    "backup-restore-equivalence",
    "mobile-clipping-accessibility",
)
UI_KINDS = (
    "route",
    "viewport",
    "interaction",
    "variant",
    "mobile-layout",
    "accessibility",
)
BUNDLED_PERSONAS = frozenset(
    {
        "security",
        "architecture",
        "performance",
        "database",
        "data-engineering",
        "frontend",
        "testing",
        "observability",
        "devops",
        "privacy",
        "ai-llm",
        "api-dx",
        "code-quality",
    }
)


class RpfContractError(ValueError):
    """Fail-closed contract violation."""


class RpfConflictError(RpfContractError):
    """Two authoritative values cannot be reduced without losing information."""


@dataclasses.dataclass(frozen=True)
class FileIdentity:
    sha256: str
    size: int
    device: int
    inode: int
    mtime_ns: int


@dataclasses.dataclass(frozen=True)
class FileObservation:
    identity: FileIdentity
    data: bytes


@dataclasses.dataclass(frozen=True)
class Classification:
    path: str
    disposition: str
    reason: str
    sha256: str | None = None
    incident_id: str | None = None
    _seal: object = dataclasses.field(default=None, repr=False)


@dataclasses.dataclass(frozen=True)
class PublishResult:
    status: str
    published_identity: FileIdentity | None
    recovery_paths: tuple[str, ...]
    assurance: str
    reconciliation_required: bool


@dataclasses.dataclass(frozen=True)
class DispatchLimits:
    wall_seconds: float
    output_bytes: int
    context_bytes: int

    def validate(self) -> None:
        values = (self.wall_seconds, self.output_bytes, self.context_bytes)
        if any(isinstance(value, bool) for value in values):
            raise RpfContractError("dispatch limits must be numeric")
        if not isinstance(self.wall_seconds, (int, float)) or not math.isfinite(
            float(self.wall_seconds)
        ):
            raise RpfContractError("wall deadline must be finite")
        if type(self.output_bytes) is not int or type(self.context_bytes) is not int:
            raise RpfContractError("byte limits must be integers")
        if not 0 < float(self.wall_seconds) <= 3600:
            raise RpfContractError("wall deadline is outside the supported bound")
        if not 0 < self.output_bytes <= 4 * 1024 * 1024:
            raise RpfContractError("output limit is outside the supported bound")
        if not 0 < self.context_bytes <= 16 * 1024 * 1024:
            raise RpfContractError("context limit is outside the supported bound")


@dataclasses.dataclass(frozen=True)
class ValidatedChildResult:
    envelope: Mapping[str, Any]
    raw: bytes
    _seal: object = dataclasses.field(repr=False)


@dataclasses.dataclass(frozen=True)
class RestrictedTransition:
    state: str
    retry_allowed: bool
    unrelated_safe_work: str


@dataclasses.dataclass(frozen=True)
class RecoveryAction:
    unit_id: str
    replacement_id: str
    strategy: str
    obligation_ids: tuple[str, ...]
    cycle: int
    role_instance: str
    run_id: str
    fence: tuple[str, tuple[str, ...], str]
    continue_run: bool = True
    _seal: object = dataclasses.field(default=None, repr=False)


@dataclasses.dataclass(frozen=True)
class TechnicalRecoveryAction:
    failure_id: str
    attempt_id: str
    strategy: str
    _seal: object = dataclasses.field(default=None, repr=False)


@dataclasses.dataclass(frozen=True)
class UserAuthorization:
    authorization_id: str
    residual_risk_id: str
    scope: str
    rationale: str
    _seal: object = dataclasses.field(repr=False)


@dataclasses.dataclass(frozen=True)
class RuntimeReceipt:
    record_id: str
    record_sha256: str
    provider_id: str
    _seal: object = dataclasses.field(repr=False)


@dataclasses.dataclass(frozen=True)
class RuntimeEvidenceProvider:
    """Trusted host adapter for an actual UI/runtime execution provider."""

    provider_id: str
    executor_id: str
    observer_id: str
    execute: Callable[[Mapping[str, Any]], Mapping[str, Any]]
    observe: Callable[[str], Mapping[str, Any]]
    _seal: object = dataclasses.field(default=None, repr=False)


@dataclasses.dataclass(frozen=True)
class UserAuthorityProvider:
    provider_id: str
    confirmer_id: str
    observer_id: str
    confirm: Callable[[Mapping[str, str]], Mapping[str, Any]]
    observe: Callable[[str], Mapping[str, Any]]
    _seal: object = dataclasses.field(default=None, repr=False)


_AUTHORITY_SEAL = object()
_CHILD_RESULT_SEAL = object()
_CLASSIFICATION_SEAL = object()
_USER_AUTHORIZATION_SEAL = object()
_RUNTIME_RECEIPT_SEAL = object()
_RUNTIME_PROVIDER_SEAL = object()
_USER_PROVIDER_SEAL = object()
_RECOVERY_ACTION_SEAL = object()
_TECHNICAL_RECOVERY_ACTION_SEAL = object()
_AUTHORITY_REGISTRY: dict[int, "ExecutionAuthority"] = {}
_CHILD_RESULT_REGISTRY: dict[int, ValidatedChildResult] = {}
_CLASSIFICATION_REGISTRY: dict[int, Classification] = {}
_USER_AUTHORIZATION_REGISTRY: dict[int, UserAuthorization] = {}
_RUNTIME_RECEIPT_REGISTRY: dict[int, RuntimeReceipt] = {}
_RUNTIME_PROVIDER_REGISTRY: dict[int, RuntimeEvidenceProvider] = {}
_USER_PROVIDER_REGISTRY: dict[int, UserAuthorityProvider] = {}
_RECOVERY_ACTION_REGISTRY: dict[int, RecoveryAction] = {}
_TECHNICAL_RECOVERY_ACTION_REGISTRY: dict[int, TechnicalRecoveryAction] = {}
_AUDIT_CAPTURE_REGISTRY: dict[int, Mapping[str, Any]] = {}
_CYCLE_EVALUATION_REGISTRY: dict[int, Mapping[str, Any]] = {}
_ISSUED_FINGERPRINTS: dict[int, tuple[Any, ...]] = {}


def _register_identity(registry: dict[int, Any], value: Any) -> Any:
    """Issue a process-local identity grant that a dataclass copy cannot inherit."""

    registry[id(value)] = value
    return value


def _has_registered_identity(registry: Mapping[int, Any], value: object) -> bool:
    return registry.get(id(value)) is value


def _record_fingerprint(value: object, *parts: Any) -> None:
    _ISSUED_FINGERPRINTS[id(value)] = tuple(parts)


def _fingerprint_matches(value: object, *parts: Any) -> bool:
    return _ISSUED_FINGERPRINTS.get(id(value)) == tuple(parts)


def _issue_recovery_action(
    unit_id: str,
    replacement_id: str,
    strategy: str,
    obligation_ids: tuple[str, ...],
    cycle: int,
    role_instance: str,
    run_id: str,
    fence: tuple[str, tuple[str, ...], str],
) -> RecoveryAction:
    action = RecoveryAction(
        unit_id,
        replacement_id,
        strategy,
        obligation_ids,
        cycle,
        role_instance,
        run_id,
        fence,
        True,
        _RECOVERY_ACTION_SEAL,
    )
    _register_identity(_RECOVERY_ACTION_REGISTRY, action)
    _record_fingerprint(
        action,
        action.unit_id,
        action.replacement_id,
        action.strategy,
        action.obligation_ids,
        action.cycle,
        action.role_instance,
        action.run_id,
        action.fence,
    )
    return action


def _recovery_action_valid(action: object) -> bool:
    return bool(
        isinstance(action, RecoveryAction)
        and action._seal is _RECOVERY_ACTION_SEAL
        and _has_registered_identity(_RECOVERY_ACTION_REGISTRY, action)
        and _fingerprint_matches(
            action,
            action.unit_id,
            action.replacement_id,
            action.strategy,
            action.obligation_ids,
            action.cycle,
            action.role_instance,
            action.run_id,
            action.fence,
        )
    )


def _issue_technical_recovery_action(
    failure_id: str, attempt_id: str, strategy: str
) -> TechnicalRecoveryAction:
    action = TechnicalRecoveryAction(
        failure_id,
        attempt_id,
        strategy,
        _TECHNICAL_RECOVERY_ACTION_SEAL,
    )
    _register_identity(_TECHNICAL_RECOVERY_ACTION_REGISTRY, action)
    _record_fingerprint(
        action,
        action.failure_id,
        action.attempt_id,
        action.strategy,
    )
    return action


def _technical_recovery_action_valid(action: object) -> bool:
    return bool(
        isinstance(action, TechnicalRecoveryAction)
        and action._seal is _TECHNICAL_RECOVERY_ACTION_SEAL
        and _has_registered_identity(_TECHNICAL_RECOVERY_ACTION_REGISTRY, action)
        and _fingerprint_matches(
            action,
            action.failure_id,
            action.attempt_id,
            action.strategy,
        )
    )


def _user_authorization_valid(value: object) -> bool:
    issued = _ISSUED_FINGERPRINTS.get(id(value))
    return bool(
        isinstance(value, UserAuthorization)
        and value._seal is _USER_AUTHORIZATION_SEAL
        and _has_registered_identity(_USER_AUTHORIZATION_REGISTRY, value)
        and issued is not None
        and len(issued) == 5
        and issued[:4]
        == (
            value.authorization_id,
            value.residual_risk_id,
            value.scope,
            value.rationale,
        )
    )


def _runtime_receipt_valid(value: object) -> bool:
    return bool(
        isinstance(value, RuntimeReceipt)
        and value._seal is _RUNTIME_RECEIPT_SEAL
        and _has_registered_identity(_RUNTIME_RECEIPT_REGISTRY, value)
        and _fingerprint_matches(
            value, value.record_id, value.record_sha256, value.provider_id
        )
    )


def register_runtime_evidence_provider(
    *,
    provider_id: str,
    executor_id: str,
    observer_id: str,
    execute: Callable[[Mapping[str, Any]], Mapping[str, Any]],
    observe: Callable[[str], Mapping[str, Any]],
    authority: "ExecutionAuthority",
) -> RuntimeEvidenceProvider:
    """Fail closed until the host supplies an out-of-process trust anchor.

    Two callbacks created by the controller are not independent evidence even
    when they are bound to different Python objects.  This repository has no
    host-owned signing key or IPC capability, so it must not mint a provider.
    The parameters remain explicit to keep older callers failing loudly rather
    than silently treating their callbacks as trusted execution.
    """

    require_mutation_authority(authority, "runtime-provider")
    del provider_id, executor_id, observer_id, execute, observe
    raise RpfContractError("external runtime provider trust anchor is unavailable")


def register_user_authority_provider(
    *,
    provider_id: str,
    confirmer_id: str,
    observer_id: str,
    confirm: Callable[[Mapping[str, str]], Mapping[str, Any]],
    observe: Callable[[str], Mapping[str, Any]],
    authority: "ExecutionAuthority",
) -> UserAuthorityProvider:
    """Fail closed until conversation authority is host-issued and verifiable."""

    require_mutation_authority(authority, "user-provider")
    del provider_id, confirmer_id, observer_id, confirm, observe
    raise RpfContractError("external user-authority trust anchor is unavailable")


def resolve_user_authorization(
    *,
    residual_risk_id: str,
    scope: str,
    rationale: str,
    user_instruction: bytes,
    provider: UserAuthorityProvider,
) -> UserAuthorization:
    """Bind risk acceptance to the exact host-supplied user instruction bytes.

    The host adapter, not an RPF child, must supply the verbatim instruction.
    Merely passing a Boolean can never create user authority.
    """

    try:
        instruction = user_instruction.decode("utf-8", errors="strict")
    except (AttributeError, UnicodeDecodeError) as error:
        raise RpfContractError("user authorization instruction is invalid") from error
    if (
        not isinstance(residual_risk_id, str)
        or not residual_risk_id
        or not isinstance(scope, str)
        or not scope
        or not isinstance(rationale, str)
        or not rationale
        or residual_risk_id not in instruction
        or scope not in instruction
        or rationale not in instruction
        or not isinstance(provider, UserAuthorityProvider)
        or provider._seal is not _USER_PROVIDER_SEAL
        or not _has_registered_identity(_USER_PROVIDER_REGISTRY, provider)
        or not _fingerprint_matches(
            provider,
            provider.provider_id,
            provider.confirmer_id,
            provider.observer_id,
            id(provider.confirm),
            id(provider.observe),
        )
        or not isinstance(provider.provider_id, str)
        or not provider.provider_id
        or not callable(provider.confirm)
        or not callable(provider.observe)
    ):
        raise RpfContractError("exact user risk authorization is incomplete")
    instruction_digest = hashlib.sha256(user_instruction).hexdigest()
    request = {
        "residual_risk_id": residual_risk_id,
        "scope": scope,
        "rationale": rationale,
        "instruction_sha256": instruction_digest,
    }
    event_id = f"user-event-{secrets.token_hex(16)}"
    expected = {
        "event_id": event_id,
        "provider_id": provider.provider_id,
        **request,
        "confirmed": True,
    }
    try:
        confirmed = dict(provider.confirm({"event_id": event_id, **request}))
        observed = dict(provider.observe(event_id))
    except Exception as error:
        raise RpfContractError("user authority provider failed") from error
    if confirmed != expected or observed != expected:
        raise RpfContractError("user instruction lacks independent host confirmation")
    value = UserAuthorization(
        f"UA-{secrets.token_hex(16)}",
        residual_risk_id,
        scope,
        rationale,
        _USER_AUTHORIZATION_SEAL,
    )
    _register_identity(_USER_AUTHORIZATION_REGISTRY, value)
    _record_fingerprint(
        value,
        value.authorization_id,
        value.residual_risk_id,
        value.scope,
        value.rationale,
        instruction_digest,
    )
    return value


def issue_runtime_receipt(
    record: Mapping[str, Any], provider: RuntimeEvidenceProvider
) -> RuntimeReceipt:
    """Execute and independently observe one immutable runtime record."""

    if (
        not isinstance(record, Mapping)
        or not isinstance(record.get("id"), str)
        or not record["id"]
        or not isinstance(provider, RuntimeEvidenceProvider)
        or provider._seal is not _RUNTIME_PROVIDER_SEAL
        or not _has_registered_identity(_RUNTIME_PROVIDER_REGISTRY, provider)
        or not _fingerprint_matches(
            provider,
            provider.provider_id,
            provider.executor_id,
            provider.observer_id,
            id(provider.execute),
            id(provider.observe),
        )
        or not isinstance(provider.provider_id, str)
        or not provider.provider_id
        or not callable(provider.execute)
        or not callable(provider.observe)
    ):
        raise RpfContractError("runtime evidence provider is incomplete")
    canonical = json.dumps(
        record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    try:
        executed = provider.execute(copy.deepcopy(dict(record)))
        observed = provider.observe(record["id"])
    except Exception as error:
        raise RpfContractError("runtime evidence provider failed") from error
    expected = {
        "record_id": record["id"],
        "record_sha256": digest,
        "provider_id": provider.provider_id,
        "completed": True,
    }
    if dict(executed) != expected or dict(observed) != expected:
        raise RpfContractError("runtime execution lacks independent provider evidence")
    receipt = RuntimeReceipt(
        record["id"], digest, provider.provider_id, _RUNTIME_RECEIPT_SEAL
    )
    _register_identity(_RUNTIME_RECEIPT_REGISTRY, receipt)
    _record_fingerprint(
        receipt, receipt.record_id, receipt.record_sha256, receipt.provider_id
    )
    return receipt


@dataclasses.dataclass(frozen=True)
class ExecutionAuthority:
    mode: str
    _seal: object = dataclasses.field(repr=False)


@dataclasses.dataclass(frozen=True)
class CancellationProvider:
    interrupt: Callable[[str], Mapping[str, Any]]
    cancel_descendants: Callable[[str], Mapping[str, Any]]
    close_stream: Callable[[str], Mapping[str, Any]]
    probe: Callable[[str], Mapping[str, Any]]
    register_probe: Callable[[str, int, int, Any], None] | None = None
    _seal: object = dataclasses.field(default=None, repr=False)

    @staticmethod
    def _receipt(value: object, action: str, dispatch_id: str) -> bool:
        return bool(
            isinstance(value, Mapping)
            and dict(value)
            == {
                "action": action,
                "dispatch_id": dispatch_id,
                "completed": True,
            }
        )

    def validate(self, *, execute_probe: bool = False) -> None:
        if any(
            not callable(callback)
            for callback in (
                self.interrupt,
                self.cancel_descendants,
                self.close_stream,
                self.probe,
            )
        ):
            raise RpfContractError("cancellation provider is incomplete")
        if execute_probe:
            if (
                self._seal is not _CANCELLATION_PROVIDER_SEAL
                or not _has_registered_identity(_CANCELLATION_PROVIDER_REGISTRY, self)
                or not _fingerprint_matches(
                    self,
                    id(self.interrupt),
                    id(self.cancel_descendants),
                    id(self.close_stream),
                    id(self.probe),
                    id(self.register_probe),
                )
            ):
                raise RpfContractError(
                    "OS cancellation probe requires the fixed host provider"
                )
            probe_id = f"rpf-cancel-probe-{secrets.token_hex(12)}"
            if not callable(self.register_probe):
                raise RpfContractError("cancellation provider lacks an OS probe registrar")
            process = subprocess.Popen(
                [
                    os.fspath(Path(sys.executable)),
                    "-c",
                    (
                        "import signal,subprocess,sys,time;"
                        "signal.signal(signal.SIGCHLD,signal.SIG_IGN);"
                        "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
                        "print(f'ready {child.pid}',flush=True);time.sleep(60)"
                    ),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            try:
                if process.stdout is None:
                    raise RpfContractError("cancellation OS probe failed to start")
                ready = process.stdout.readline().decode("ascii", errors="strict").split()
                if len(ready) != 2 or ready[0] != "ready" or not ready[1].isdigit():
                    raise RpfContractError("cancellation OS probe failed to start")
                child_pid = int(ready[1])
                self.register_probe(probe_id, process.pid, child_pid, process.stdout)
                for _ in range(3):
                    time.sleep(0.01)
                    process.poll()
                    try:
                        os.killpg(process.pid, 0)
                    except (ProcessLookupError, PermissionError) as error:
                        raise RpfContractError(
                            "cancellation registrar altered the probe before callbacks"
                        ) from error
                    if process.poll() is not None:
                        raise RpfContractError(
                            "cancellation registrar altered the probe before callbacks"
                        )
                close_receipt = self.close_stream(probe_id)
                if (
                    not self._receipt(close_receipt, "stream_close", probe_id)
                    or not process.stdout.closed
                    or process.poll() is not None
                ):
                    raise RpfContractError(
                        "stream-close capability lacks an independent effect"
                    )
                descendant_receipt = self.cancel_descendants(probe_id)
                descendant_deadline = time.monotonic() + 1.0
                child_alive = True
                while time.monotonic() < descendant_deadline:
                    try:
                        os.kill(child_pid, 0)
                    except (ProcessLookupError, PermissionError):
                        child_alive = False
                        break
                    time.sleep(0.01)
                if (
                    not self._receipt(descendant_receipt, "descendants", probe_id)
                    or child_alive
                    or process.poll() is not None
                ):
                    raise RpfContractError(
                        "descendant cancellation lacks an independent effect"
                    )
                interrupt_receipt = self.interrupt(probe_id)
                deadline = time.monotonic() + 1.0
                while time.monotonic() < deadline and process.poll() is None:
                    process.poll()
                    time.sleep(0.01)
                evidence = self.probe(probe_id)
                if (
                    not self._receipt(interrupt_receipt, "interrupt", probe_id)
                    or not isinstance(evidence, Mapping)
                    or dict(evidence)
                    != {
                        "dispatch_id": probe_id,
                        "interrupt_observed": True,
                        "descendants_observed": True,
                        "stream_closed_observed": True,
                    }
                    or process.poll() is None
                ):
                    raise RpfContractError(
                        "cancellation provider probe is incomplete"
                    )
            except Exception as error:
                if isinstance(error, RpfContractError):
                    raise
                raise RpfContractError("cancellation provider probe failed") from error
            finally:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except (ProcessLookupError, PermissionError):
                        process.kill()
                process.wait(timeout=2)
                if process.stdout is not None and not process.stdout.closed:
                    process.stdout.close()


_CANCELLATION_PROVIDER_SEAL = object()
_CANCELLATION_PROVIDER_REGISTRY: dict[int, CancellationProvider] = {}


def create_os_cancellation_provider() -> CancellationProvider:
    """Return the fixed OS-backed provider used by capability handshakes."""

    registered: dict[str, dict[str, Any]] = {}

    def register(dispatch_id: str, pid: int, child_pid: int, stream: Any) -> None:
        if (
            not isinstance(dispatch_id, str)
            or not dispatch_id
            or dispatch_id in registered
            or type(pid) is not int
            or type(child_pid) is not int
            or pid <= 1
            or child_pid <= 1
            or pid == child_pid
            or not hasattr(stream, "close")
            or not hasattr(stream, "closed")
            or os.getpgid(pid) != pid
            or os.getpgid(child_pid) != pid
        ):
            raise RpfContractError("dispatch host registration is invalid")
        registered[dispatch_id] = {
            "pid": pid,
            "child_pid": child_pid,
            "stream": stream,
            "interrupt": False,
            "descendants": False,
            "stream_close": False,
        }

    def interrupt(dispatch_id: str) -> Mapping[str, Any]:
        row = registered[dispatch_id]
        os.kill(row["pid"], signal.SIGTERM)
        row["interrupt"] = True
        return {"action": "interrupt", "dispatch_id": dispatch_id, "completed": True}

    def descendants(dispatch_id: str) -> Mapping[str, Any]:
        row = registered[dispatch_id]
        os.kill(row["child_pid"], signal.SIGKILL)
        row["descendants"] = True
        return {"action": "descendants", "dispatch_id": dispatch_id, "completed": True}

    def close_stream(dispatch_id: str) -> Mapping[str, Any]:
        row = registered[dispatch_id]
        row["stream"].close()
        row["stream_close"] = True
        return {"action": "stream_close", "dispatch_id": dispatch_id, "completed": True}

    def probe(dispatch_id: str) -> Mapping[str, Any]:
        row = registered[dispatch_id]
        return {
            "dispatch_id": dispatch_id,
            "interrupt_observed": row["interrupt"],
            "descendants_observed": row["descendants"],
            "stream_closed_observed": row["stream_close"] and row["stream"].closed,
        }

    provider = CancellationProvider(
        interrupt,
        descendants,
        close_stream,
        probe,
        register,
        _CANCELLATION_PROVIDER_SEAL,
    )
    _register_identity(_CANCELLATION_PROVIDER_REGISTRY, provider)
    _record_fingerprint(
        provider,
        id(provider.interrupt),
        id(provider.cancel_descendants),
        id(provider.close_stream),
        id(provider.probe),
        id(provider.register_probe),
    )
    return provider


def resolve_execution_mode(
    *, mutation_authorized: bool, explicit_mode: str | None = None
) -> ExecutionAuthority:
    """Resolve authority once at invocation intake.

    A user request limited to review/reporting sets ``mutation_authorized`` to
    false.  An explicit full mode can never broaden that authority.
    """

    if explicit_mode not in {None, AUDIT_MODE, FULL_MODE}:
        raise RpfContractError("mode must be audit or full")
    if explicit_mode == FULL_MODE and not mutation_authorized:
        raise RpfContractError("full mode requires explicit mutation authority")
    mode = AUDIT_MODE if explicit_mode == AUDIT_MODE or not mutation_authorized else FULL_MODE
    value = ExecutionAuthority(mode, _AUTHORITY_SEAL)
    _register_identity(_AUTHORITY_REGISTRY, value)
    _record_fingerprint(value, value.mode)
    return value


def require_mutation_authority(authority: ExecutionAuthority, sink: str) -> None:
    if (
        not isinstance(authority, ExecutionAuthority)
        or authority._seal is not _AUTHORITY_SEAL
        or not _has_registered_identity(_AUTHORITY_REGISTRY, authority)
        or not _fingerprint_matches(authority, authority.mode)
        or authority.mode != FULL_MODE
    ):
        raise PermissionError(f"{sink} is disabled in audit mode")
    if sink not in {
        "source",
        "pointer",
        "git-index",
        "commit",
        "push",
        "deploy",
        "artifact",
        "artifact-retention",
        "runtime-provider",
        "user-provider",
    }:
        raise RpfContractError("unknown mutation sink")


def _normalized_scope(scope: object) -> tuple[str, ...] | None:
    if not isinstance(scope, (list, tuple)) or not scope:
        return None
    if any(not isinstance(path, str) for path in scope):
        return None
    paths = tuple(scope)
    if paths != tuple(sorted(paths, key=lambda value: value.encode("utf-8"))):
        return None
    if len(paths) != len(set(paths)):
        return None
    for path in paths:
        parts = path.split("/")
        if (
            not path
            or path.startswith("/")
            or "\\" in path
            or any(ord(char) < 32 or ord(char) == 127 for char in path)
            or any(part in {"", ".", ".."} for part in parts)
            or any(char in path for char in "*?[")
        ):
            return None
    return paths


def scope_digest(scope: Sequence[str], source_bytes: Mapping[str, bytes]) -> str:
    if not isinstance(source_bytes, Mapping) or any(
        not isinstance(path, str) or not isinstance(data, bytes)
        for path, data in source_bytes.items()
    ):
        raise RpfContractError("approved source index must map paths to bytes")
    normalized = _normalized_scope(scope)
    if normalized is None or set(normalized) != set(source_bytes):
        raise RpfContractError("scope and approved source index must match exactly")
    payload = b"".join(
        path.encode("utf-8")
        + b"\0"
        + hashlib.sha256(source_bytes[path]).hexdigest().encode("ascii")
        + b"\n"
        for path in normalized
    )
    return hashlib.sha256(payload).hexdigest()


def canonical_fence(
    base: object,
    scope: object,
    claimed_hash: object,
    source_bytes: Mapping[str, bytes],
    *,
    repository_root: Path,
    allow_pre_contract: bool = False,
) -> tuple[str, tuple[str, ...], str]:
    if not isinstance(base, str) or not (
        re.fullmatch(r"[0-9a-f]{40}", base)
        or (allow_pre_contract and base == "PRE-CONTRACT")
    ):
        raise RpfContractError("invalid base identity")
    if base != "PRE-CONTRACT":
        try:
            completed = subprocess.run(
                ["git", "merge-base", "--is-ancestor", base, "HEAD"],
                cwd=repository_root.resolve(strict=True),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise RpfContractError("base commit could not be verified") from error
        if completed.returncode != 0:
            raise RpfContractError("base commit is not an ancestor of repository HEAD")
    normalized = _normalized_scope(scope)
    if normalized is None:
        raise RpfContractError("invalid canonical scope")
    if not isinstance(claimed_hash, str) or not re.fullmatch(
        r"[0-9a-f]{64}", claimed_hash
    ):
        raise RpfContractError("invalid scope hash")
    if scope_digest(normalized, source_bytes) != claimed_hash:
        raise RpfContractError("scope hash does not match approved bytes")
    root = repository_root.resolve(strict=True)
    for relative in normalized:
        candidate = root / relative
        directory_fd: int | None = None
        try:
            lexical = Path(os.path.abspath(candidate))
            relative_path = lexical.relative_to(root)
            directory_fd, _ = _open_repository_directory(
                root, relative_path.parts[:-1], create=False
            )
            observed = _read_at(
                directory_fd,
                relative_path.name,
                max_bytes=16 * 1024 * 1024,
            )
            if not _directory_path_matches_fd(lexical, directory_fd):
                raise RpfConflictError("repository source parent identity changed")
        except (OSError, RpfConflictError, RpfContractError, ValueError) as error:
            raise RpfContractError(
                f"approved source is not an exact repository file: {relative}"
            ) from error
        finally:
            if directory_fd is not None:
                os.close(directory_fd)
        if observed != source_bytes.get(relative):
            raise RpfConflictError(
                f"approved source bytes differ from repository content: {relative}"
            )
    return base, normalized, claimed_hash


def fence_shape_valid(value: object) -> bool:
    try:
        if not isinstance(value, tuple) or len(value) != 3:
            return False
        base, scope, digest = value
        return bool(
            isinstance(base, str)
            and (re.fullmatch(r"[0-9a-f]{40}", base) or base == "PRE-CONTRACT")
            and _normalized_scope(scope) is not None
            and isinstance(digest, str)
            and re.fullmatch(r"[0-9a-f]{64}", digest)
        )
    except (AttributeError, TypeError, ValueError):
        return False


def _read_stable(path: Path) -> tuple[bytes, os.stat_result]:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise RpfContractError("file must be an exact regular file")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RpfConflictError("file changed while it was observed")
    return b"".join(chunks), after


def _repository_pointer(path: Path, repository_root: Path, *, exists: bool) -> Path:
    root = repository_root.resolve(strict=True)
    absolute = Path(os.path.abspath(path if path.is_absolute() else Path.cwd() / path))
    try:
        relative = absolute.relative_to(root)
    except ValueError as error:
        raise RpfContractError("pointer path is outside the repository") from error
    directory_fd, _ = _open_repository_directory(
        root, relative.parts[:-1], create=not exists
    )
    try:
        if exists:
            flags = (
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_NONBLOCK", 0)
            )
            descriptor = os.open(relative.name, flags, dir_fd=directory_fd)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise RpfContractError("pointer is not a regular file")
            finally:
                os.close(descriptor)
    finally:
        os.close(directory_fd)
    return root / relative


def _repository_relative(path: Path, repository_root: Path) -> tuple[Path, Path]:
    """Return a lexical repository path without following attacker-controlled parents."""

    root_lexical = Path(os.path.abspath(repository_root))
    root = root_lexical.resolve(strict=True)
    absolute = Path(os.path.abspath(path if path.is_absolute() else Path.cwd() / path))
    try:
        relative = absolute.relative_to(root_lexical)
    except ValueError as error:
        raise RpfContractError("path is outside the repository") from error
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise RpfContractError("repository path is not canonical")
    return root, relative


def _directory_path_matches_fd(path: Path, directory_fd: int) -> bool:
    return _directory_matches_fd(path.parent, directory_fd)


def _directory_matches_fd(directory: Path, directory_fd: int) -> bool:
    try:
        by_path = os.stat(directory, follow_symlinks=False)
        by_fd = os.fstat(directory_fd)
        return bool(
            stat.S_ISDIR(by_path.st_mode)
            and stat.S_ISDIR(by_fd.st_mode)
            and (by_path.st_dev, by_path.st_ino) == (by_fd.st_dev, by_fd.st_ino)
        )
    except OSError:
        return False


def _open_repository_directory(
    repository_root: Path,
    relative_parts: Sequence[str],
    *,
    create: bool,
) -> tuple[int, Path]:
    """Open each directory by descriptor with NOFOLLOW to close symlink races."""

    root = repository_root.resolve(strict=True)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(root, flags)
    current = root
    try:
        for part in relative_parts:
            if not isinstance(part, str) or part in {"", ".", ".."} or "/" in part:
                raise RpfContractError("repository directory component is invalid")
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            next_descriptor = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
            current /= part
        return descriptor, current
    except Exception:
        os.close(descriptor)
        raise


def _write_private_at(
    directory_fd: int,
    name: str,
    data: bytes,
    *,
    exclusive: bool = True,
) -> None:
    if (
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
    ):
        raise RpfContractError("repository filename is invalid")
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    flags |= os.O_EXCL if exclusive else os.O_TRUNC
    descriptor = os.open(name, flags, 0o600, dir_fd=directory_fd)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise RpfContractError("repository sink is not a regular file")
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def observe_exact(path: Path) -> FileIdentity:
    data, info = _read_stable(path)
    return FileIdentity(
        hashlib.sha256(data).hexdigest(),
        len(data),
        info.st_dev,
        info.st_ino,
        info.st_mtime_ns,
    )


def observe_snapshot(path: Path) -> FileObservation:
    """Return exact bytes with the identity used to validate publication."""

    data, info = _read_stable(path)
    return FileObservation(
        FileIdentity(
            hashlib.sha256(data).hexdigest(),
            len(data),
            info.st_dev,
            info.st_ino,
            info.st_mtime_ns,
        ),
        data,
    )


def atomic_exchange_available() -> bool:
    if os.name != "posix":
        return False
    libc = ctypes.CDLL(None, use_errno=True)
    return bool(hasattr(libc, "renameatx_np") or hasattr(libc, "renameat2"))


def atomic_exchange_works(directory: Path) -> bool:
    """Probe the mounted filesystem without touching an authoritative file."""

    if not atomic_exchange_available():
        return False
    left: Path | None = None
    right: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=".rpf-exchange-left-", dir=directory, delete=False
        ) as handle:
            left = Path(handle.name)
            handle.write(b"left")
            handle.flush()
            os.fsync(handle.fileno())
        with tempfile.NamedTemporaryFile(
            prefix=".rpf-exchange-right-", dir=directory, delete=False
        ) as handle:
            right = Path(handle.name)
            handle.write(b"right")
            handle.flush()
            os.fsync(handle.fileno())
        _atomic_exchange(left, right)
        return left.read_bytes() == b"right" and right.read_bytes() == b"left"
    except OSError:
        return False
    finally:
        if left is not None:
            left.unlink(missing_ok=True)
        if right is not None:
            right.unlink(missing_ok=True)


def _atomic_exchange(left: Path, right: Path) -> None:
    if left.parent != right.parent:
        raise RpfContractError("atomic exchange paths must share a directory")
    libc = ctypes.CDLL(None, use_errno=True)
    left_bytes = os.fsencode(left)
    right_bytes = os.fsencode(right)
    result = -1
    if hasattr(libc, "renamex_np"):
        renamex_np = libc.renamex_np
        renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        renamex_np.restype = ctypes.c_int
        result = renamex_np(left_bytes, right_bytes, 0x00000002)  # RENAME_SWAP
    elif hasattr(libc, "renameat2"):
        renameat2 = libc.renameat2
        renameat2.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameat2.restype = ctypes.c_int
        result = renameat2(-100, left_bytes, -100, right_bytes, 0x00000002)
    if result != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def _atomic_exchange_at(directory_fd: int, left: str, right: str) -> None:
    """Exchange two entries relative to one already-verified directory FD."""

    if any(
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        for name in (left, right)
    ):
        raise RpfContractError("atomic exchange filename is invalid")
    libc = ctypes.CDLL(None, use_errno=True)
    left_bytes = os.fsencode(left)
    right_bytes = os.fsencode(right)
    result = -1
    if hasattr(libc, "renameatx_np"):
        renameatx_np = libc.renameatx_np
        renameatx_np.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameatx_np.restype = ctypes.c_int
        result = renameatx_np(
            directory_fd,
            left_bytes,
            directory_fd,
            right_bytes,
            0x00000002,
        )
    elif hasattr(libc, "renameat2"):
        renameat2 = libc.renameat2
        renameat2.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameat2.restype = ctypes.c_int
        result = renameat2(
            directory_fd,
            left_bytes,
            directory_fd,
            right_bytes,
            0x00000002,
        )
    if result != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def _recovery_directory(pointer: Path, repository_root: Path, run_id: str) -> Path:
    if not isinstance(run_id, str) or re.fullmatch(r"[A-Za-z0-9._:-]+", run_id) is None:
        raise RpfContractError("recovery run identity is invalid")
    root, relative = _repository_relative(pointer, repository_root)
    pointer_id = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[:20]
    parts = (".context", "rpf-recovery", pointer_id, run_id)
    descriptor, path = _open_repository_directory(root, parts, create=True)
    os.close(descriptor)
    return path


def _read_at(directory_fd: int, name: str, *, max_bytes: int) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(name, flags, dir_fd=directory_fd)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise RpfContractError("repository artifact is not a bounded regular file")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        if len(data) > max_bytes:
            raise RpfContractError("repository artifact exceeds its byte limit")
        return data
    finally:
        os.close(descriptor)


def _observe_at(directory_fd: int, name: str) -> FileObservation:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(name, flags, dir_fd=directory_fd)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise RpfContractError("observed repository entry is not a regular file")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RpfConflictError("repository entry changed while observed")
    data = b"".join(chunks)
    return FileObservation(
        FileIdentity(
            hashlib.sha256(data).hexdigest(),
            len(data),
            after.st_dev,
            after.st_ino,
            after.st_mtime_ns,
        ),
        data,
    )


def _preserve_exact_variant(
    directory_fd: int, directory: Path, label: str, data: bytes
) -> Path:
    digest = hashlib.sha256(data).hexdigest()
    name = f"{label}-{digest}.bin"
    path = directory / name
    try:
        existing = _read_at(directory_fd, name, max_bytes=max(len(data), 1))
    except FileNotFoundError:
        existing = None
    except (OSError, RpfContractError):
        existing = b""
    if existing is not None:
        if existing == data:
            return path
        name = f"{label}-{digest}-{secrets.token_hex(12)}.bin"
        path = directory / name
    _write_private_at(directory_fd, name, data)
    return path


def _retain_live_displaced_at(
    source_fd: int,
    source_name: str,
    source_display: Path,
    recovery_dir: Path,
    label: str,
    *,
    repository_root: Path,
) -> Path:
    current_fd = source_fd
    current_name = source_name
    owned_fd: int | None = None
    for _ in range(3):
        root, recovery_relative = _repository_relative(recovery_dir, repository_root)
        recovery_fd, _ = _open_repository_directory(
            root, recovery_relative.parts, create=True
        )
        retained_name = f"{label}-live-{secrets.token_hex(12)}.bin"
        try:
            os.rename(
                current_name,
                retained_name,
                src_dir_fd=current_fd,
                dst_dir_fd=recovery_fd,
            )
        except OSError:
            os.close(recovery_fd)
            if owned_fd is not None:
                os.close(owned_fd)
            return source_display
        if owned_fd is not None:
            os.close(owned_fd)
        if _directory_matches_fd(recovery_dir, recovery_fd):
            os.close(recovery_fd)
            return recovery_dir / retained_name
        current_fd = recovery_fd
        current_name = retained_name
        owned_fd = recovery_fd
    if owned_fd is not None:
        os.close(owned_fd)
    raise RpfConflictError("recovery directory identity did not stabilize")


def _preserve_reconciliation(
    recovery_dir: Path,
    *,
    repository_root: Path,
    base: bytes | None,
    current: bytes,
    candidate: bytes,
    reason: str,
) -> tuple[str, ...]:
    root, relative = _repository_relative(recovery_dir, repository_root)
    directory_fd, _ = _open_repository_directory(root, relative.parts, create=True)
    variants: list[dict[str, str]] = []
    paths: list[str] = []
    try:
        if not _directory_matches_fd(recovery_dir, directory_fd):
            raise RpfConflictError("recovery directory identity changed before write")
        for role, data in (("base", base), ("current", current), ("candidate", candidate)):
            if data is None:
                continue
            if _document_restricted(data):
                variants.append(
                    {
                        "role": role,
                        "disposition": "restricted",
                        "incident_id": f"INC-{secrets.token_hex(12)}",
                    }
                )
                continue
            digest = hashlib.sha256(data).hexdigest()
            variant_path = _preserve_exact_variant(directory_fd, recovery_dir, role, data)
            paths.append(str(variant_path))
            variants.append({"role": role, "sha256": digest, "path": str(variant_path)})
        manifest_bytes = json.dumps(
            {"format": "rpf-reconciliation-v1", "reason": reason, "variants": variants},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        manifest_digest = hashlib.sha256(manifest_bytes).hexdigest()
        manifest_name = f"reconciliation-{manifest_digest}.json"
        manifest = recovery_dir / manifest_name
        try:
            existing = _read_at(directory_fd, manifest_name, max_bytes=max(len(manifest_bytes), 1))
        except FileNotFoundError:
            existing = None
        except (OSError, RpfContractError):
            existing = b""
        if existing is not None and existing != manifest_bytes:
            manifest_name = f"reconciliation-{manifest_digest}-{secrets.token_hex(12)}.json"
            manifest = recovery_dir / manifest_name
            existing = None
        if existing is None:
            _write_private_at(directory_fd, manifest_name, manifest_bytes)
        paths.append(str(manifest))
        if not _directory_matches_fd(recovery_dir, directory_fd) or not all(
            Path(path).is_file() for path in paths
        ):
            raise RpfConflictError("recovery directory identity changed after write")
        return tuple(paths)
    finally:
        os.close(directory_fd)


def _revisioned_markdown_rows(
    document: bytes, heading: str
) -> Mapping[str, tuple[int, bytes]]:
    try:
        text = document.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise RpfContractError("pointer must be UTF-8") from error
    aliases = {
        "Goal gaps": "Managed goal-gap index",
        "Managed goal-gap index": "Goal gaps",
    }
    matches = [
        match
        for candidate_heading in (heading, aliases.get(heading))
        if candidate_heading is not None
        for match in [
            re.search(
                rf"^#{{2,3}} {re.escape(candidate_heading)}\n(?P<body>.*?)(?=^#{{2,3}} |\Z)",
                text,
                flags=re.MULTILINE | re.DOTALL,
            )
        ]
        if match is not None
    ]
    if len(matches) != 1:
        raise RpfContractError(f"pointer is missing {heading}")
    match = matches[0]
    lines = [line for line in match.group("body").splitlines() if line.startswith("|")]
    if len(lines) < 2:
        raise RpfContractError(f"{heading} table is malformed")
    header = list(_markdown_table_cells(lines[0]))
    if "ID" not in header or "Rev" not in header:
        raise RpfContractError(f"{heading} table lacks ID/Rev")
    id_index, rev_index = header.index("ID"), header.index("Rev")
    rows: dict[str, tuple[int, bytes]] = {}
    for line in lines[2:]:
        cells = list(_markdown_table_cells(line))
        if len(cells) != len(header):
            raise RpfContractError(f"{heading} row shape is malformed")
        row_id = cells[id_index]
        if not row_id:
            continue
        try:
            revision = int(cells[rev_index])
        except ValueError as error:
            raise RpfContractError(f"{heading} revision is malformed") from error
        encoded = line.encode("utf-8")
        if row_id in rows and rows[row_id] != (revision, encoded):
            raise RpfConflictError(f"duplicate divergent {heading} row")
        rows[row_id] = revision, encoded
    return rows


def _markdown_table_records(
    document: bytes, heading: str
) -> tuple[Mapping[str, str], ...]:
    """Parse one exact projection table for semantic authority cross-checks."""

    try:
        text = document.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise RpfContractError("pointer must be UTF-8") from error
    match = re.search(
        rf"^#{{2,3}} {re.escape(heading)}\n(?P<body>.*?)(?=^#{{2,3}} |\Z)",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise RpfContractError(f"pointer is missing {heading}")
    lines = [line for line in match.group("body").splitlines() if line.startswith("|")]
    if len(lines) < 2:
        raise RpfContractError(f"{heading} table is malformed")
    header = _markdown_table_cells(lines[0])
    if len(header) != len(set(header)) or any(not cell for cell in header):
        raise RpfContractError(f"{heading} header is malformed")
    rows: list[Mapping[str, str]] = []
    for line in lines[2:]:
        cells = _markdown_table_cells(line)
        if len(cells) != len(header):
            raise RpfContractError(f"{heading} row shape is malformed")
        if any(cells):
            rows.append(dict(zip(header, cells)))
    return tuple(rows)


def _markdown_table_cells(line: str) -> tuple[str, ...]:
    """Split one Markdown table row without treating inline-code pipes as cells."""

    if not line.startswith("|") or not line.endswith("|"):
        raise RpfContractError("Markdown table row lacks boundary delimiters")
    cells: list[str] = []
    cell: list[str] = []
    code_ticks = 0
    index = 1
    end = len(line) - 1
    while index < end:
        character = line[index]
        if character == "`":
            run_end = index + 1
            while run_end < end and line[run_end] == "`":
                run_end += 1
            run = run_end - index
            if code_ticks == 0:
                code_ticks = run
            elif run == code_ticks:
                code_ticks = 0
            cell.append(line[index:run_end])
            index = run_end
            continue
        if character == "|" and code_ticks == 0:
            preceding_backslashes = 0
            cursor = index - 1
            while cursor >= 1 and line[cursor] == "\\":
                preceding_backslashes += 1
                cursor -= 1
            if preceding_backslashes % 2 == 0:
                cells.append("".join(cell).strip())
                cell = []
                index += 1
                continue
        cell.append(character)
        index += 1
    if code_ticks:
        raise RpfContractError("Markdown table row has an unclosed code span")
    cells.append("".join(cell).strip())
    return tuple(cells)


def _validate_legacy_revision_migration(
    current: bytes, candidate: bytes, heading: str
) -> None:
    """Allow one exact legacy-table migration that only adds ``Rev``.

    An authority-less pointer may predate revisioned Work/Gap rows.  The first
    authority publication must preserve every legacy ID and logical cell while
    adding exactly one non-negative revision column; it cannot add, remove, or
    otherwise edit a row in the same transition.
    """

    def parse(document: bytes) -> tuple[tuple[str, ...], Mapping[str, tuple[str, ...]]]:
        try:
            text = document.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise RpfContractError("pointer must be UTF-8") from error
        aliases = {
            "Goal gaps": "Managed goal-gap index",
            "Managed goal-gap index": "Goal gaps",
        }
        matches = [
            match
            for candidate_heading in (heading, aliases.get(heading))
            if candidate_heading is not None
            for match in [
                re.search(
                    rf"^#{{2,3}} {re.escape(candidate_heading)}\n(?P<body>.*?)(?=^#{{2,3}} |\Z)",
                    text,
                    flags=re.MULTILINE | re.DOTALL,
                )
            ]
            if match is not None
        ]
        if len(matches) != 1:
            raise RpfContractError(f"pointer is missing {heading}")
        match = matches[0]
        lines = [line for line in match.group("body").splitlines() if line.startswith("|")]
        if len(lines) < 2:
            raise RpfContractError(f"{heading} table is malformed")
        header = _markdown_table_cells(lines[0])
        if "ID" not in header:
            raise RpfContractError(f"{heading} table lacks ID")
        id_index = header.index("ID")
        rows: dict[str, tuple[str, ...]] = {}
        for line in lines[2:]:
            cells = _markdown_table_cells(line)
            if len(cells) != len(header):
                raise RpfContractError(f"{heading} row shape is malformed")
            row_id = cells[id_index]
            if not row_id:
                continue
            if row_id in rows:
                raise RpfConflictError(f"duplicate {heading} row")
            rows[row_id] = cells
        return header, rows

    before_header, before_rows = parse(current)
    after_header, after_rows = parse(candidate)
    if "Rev" in before_header or after_header.count("Rev") != 1:
        raise RpfContractError(f"{heading} is not an eligible legacy revision migration")
    rev_index = after_header.index("Rev")
    if after_header[:rev_index] + after_header[rev_index + 1 :] != before_header:
        raise RpfConflictError(f"{heading} migration changed legacy columns")
    if set(after_rows) != set(before_rows):
        raise RpfConflictError(f"{heading} migration changed legacy row identities")
    for row_id, before_cells in before_rows.items():
        after_cells = after_rows[row_id]
        try:
            revision = int(after_cells[rev_index])
        except ValueError as error:
            raise RpfContractError(f"{heading} revision is malformed") from error
        if revision < 0:
            raise RpfContractError(f"{heading} revision is malformed")
        if after_cells[:rev_index] + after_cells[rev_index + 1 :] != before_cells:
            raise RpfConflictError(f"{heading} migration changed legacy row {row_id}")


def validate_pointer_candidate(current: bytes, candidate: bytes) -> None:
    """Reject semantic equal-revision loss before opaque byte publication."""

    candidate_authority = parse_root_authority(candidate)
    current_matches = list(_AUTHORITY_BLOCK.finditer(current))
    if current_matches:
        current_authority = parse_root_authority(current)
        if candidate_authority.get("pointer_revision") <= current_authority.get(
            "pointer_revision", -1
        ):
            raise RpfConflictError("pointer revision must increase")
    for heading in ("Work queue", "Managed goal-gap index"):
        try:
            before = _revisioned_markdown_rows(current, heading)
        except RpfContractError:
            if current_matches:
                raise
            _validate_legacy_revision_migration(current, candidate, heading)
            continue
        after = _revisioned_markdown_rows(candidate, heading)
        missing = set(before) - set(after)
        if missing:
            raise RpfConflictError(
                f"{heading} candidate deleted authoritative rows: {sorted(missing)}"
            )
        for row_id in before.keys() & after.keys():
            before_rev, before_bytes = before[row_id]
            after_rev, after_bytes = after[row_id]
            if before_rev == after_rev and before_bytes != after_bytes:
                raise RpfConflictError(
                    f"equal-revision {heading} conflict for {row_id}"
                )
            if after_rev < before_rev:
                raise RpfConflictError(
                    f"lower-revision {heading} replacement for {row_id}"
                )
    if current_matches:
        current_criteria = current_authority.get("completion_criteria")
        candidate_criteria = candidate_authority.get("completion_criteria")
        if not isinstance(current_criteria, list) or not isinstance(
            candidate_criteria, list
        ):
            raise RpfContractError("completion criteria are not authoritative")
        before = {
            item.get("id"): item
            for item in current_criteria
            if isinstance(item, Mapping)
        }
        after = {
            item.get("id"): item
            for item in candidate_criteria
            if isinstance(item, Mapping)
        }
        if set(before) - set(after):
            raise RpfConflictError("candidate deleted completion criteria")
        if any(
            authority_digest(after[criterion_id])
            != authority_digest(before[criterion_id])
            for criterion_id in before
        ):
            raise RpfConflictError("candidate weakened completion criteria")


@dataclasses.dataclass(frozen=True)
class PointerLockToken:
    pointer: Path
    run_id: str
    nonce: str
    lock_path: Path
    parent_fd: int = dataclasses.field(repr=False)
    lock_fd: int = dataclasses.field(repr=False)


_LOCK_TOKEN_REGISTRY: dict[int, PointerLockToken] = {}


def _lock_owner_bytes(run_id: str, nonce: str) -> bytes:
    return json.dumps(
        {"format": "rpf-lock-v1", "run_id": run_id, "nonce": nonce},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _pointer_lock_owned(token: PointerLockToken) -> bool:
    try:
        if (
            not _has_registered_identity(_LOCK_TOKEN_REGISTRY, token)
            or not _fingerprint_matches(
                token,
                token.pointer,
                token.run_id,
                token.nonce,
                token.lock_path,
                token.parent_fd,
                token.lock_fd,
            )
        ):
            return False
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        descriptor = os.open("owner.json", flags, dir_fd=token.lock_fd)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
                return False
            data = os.read(descriptor, 4097)
        finally:
            os.close(descriptor)
        return data == _lock_owner_bytes(token.run_id, token.nonce)
    except (OSError, RpfContractError):
        return False


@contextmanager
def _use_existing_lock(token: PointerLockToken):
    yield token


@contextmanager
def acquire_pointer_lock(
    pointer: Path,
    run_id: str,
    *,
    authority: ExecutionAuthority,
    repository_root: Path,
):
    """Acquire one owner-bound lock; orphaned locks require reconciliation."""

    require_mutation_authority(authority, "pointer")
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]+", run_id):
        raise RpfContractError("lock run identity is invalid")
    resolved = _repository_pointer(pointer, repository_root, exists=True)
    root, relative = _repository_relative(resolved, repository_root)
    parent_fd, parent_path = _open_repository_directory(
        root, relative.parts[:-1], create=False
    )
    lock_name = relative.name + ".lock"
    try:
        os.mkdir(lock_name, mode=0o700, dir_fd=parent_fd)
    except FileExistsError as error:
        os.close(parent_fd)
        raise RpfConflictError("pointer lock is busy or orphaned") from error
    try:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        lock_fd = os.open(lock_name, flags, dir_fd=parent_fd)
    except Exception:
        os.rmdir(lock_name, dir_fd=parent_fd)
        os.close(parent_fd)
        raise
    nonce = secrets.token_hex(16)
    token = PointerLockToken(
        resolved,
        run_id,
        nonce,
        parent_path / lock_name,
        parent_fd,
        lock_fd,
    )
    _register_identity(_LOCK_TOKEN_REGISTRY, token)
    _record_fingerprint(
        token,
        token.pointer,
        token.run_id,
        token.nonce,
        token.lock_path,
        token.parent_fd,
        token.lock_fd,
    )
    try:
        _write_private_at(lock_fd, "owner.json", _lock_owner_bytes(run_id, nonce))
        if not _pointer_lock_owned(token):
            raise RpfConflictError("pointer lock ownership could not be verified")
        yield token
    finally:
        if _pointer_lock_owned(token):
            os.unlink("owner.json", dir_fd=lock_fd)
            os.rmdir(lock_name, dir_fd=parent_fd)
        _LOCK_TOKEN_REGISTRY.pop(id(token), None)
        _ISSUED_FINGERPRINTS.pop(id(token), None)
        os.close(lock_fd)
        os.close(parent_fd)


def publish_if_exact(
    pointer: Path,
    expected: FileIdentity | FileObservation,
    candidate: bytes,
    *,
    authority: ExecutionAuthority,
    run_id: str,
    approved_fence: tuple[str, tuple[str, ...], str],
    source_bytes: Mapping[str, bytes],
    repository_root: Path,
    lock_token: PointerLockToken | None = None,
    validated_results: Sequence[ValidatedChildResult] = (),
    user_authorizations: Sequence[UserAuthorization] = (),
    runtime_receipts: Sequence[RuntimeReceipt] = (),
    recovery_snapshot: bytes = b"",
    dispatch_ledger: DispatchLedger | None = None,
) -> PublishResult:
    """Publish only through conflict-preserving native exchange.

    The cooperative lock coordinates RPF writers but is not publication
    authority: an editor that ignores it can still race.  Therefore absence or
    failure of native exchange defers the write and preserves reconciliation
    inputs.  Pass ``observe_snapshot`` so the exact base is preserved too.
    """

    require_mutation_authority(authority, "pointer")
    pointer = _repository_pointer(pointer, repository_root, exists=True)
    recovery_dir = _recovery_directory(pointer, repository_root, run_id)
    expected_identity = expected.identity if isinstance(expected, FileObservation) else expected
    base = expected.data if isinstance(expected, FileObservation) else None
    assurance = "atomic-exchange-with-rollback"
    temp_name: str | None = None
    lock_context = (
        _use_existing_lock(lock_token)
        if lock_token is not None
        else acquire_pointer_lock(
            pointer,
            run_id,
            authority=authority,
            repository_root=repository_root,
        )
    )
    with lock_context as active_lock:
        if (
            not isinstance(active_lock, PointerLockToken)
            or active_lock.pointer != pointer
            or active_lock.run_id != run_id
            or not _pointer_lock_owned(active_lock)
        ):
            raise RpfContractError("pointer publication requires the exact owned lock")
        observed_snapshot = _observe_at(active_lock.parent_fd, pointer.name)
        if _document_restricted(observed_snapshot.data) or _document_restricted(candidate):
            return PublishResult(
                "blocked-restricted",
                None,
                _preserve_reconciliation(
                    recovery_dir,
                    repository_root=repository_root,
                    base=base,
                    current=observed_snapshot.data,
                    candidate=candidate,
                    reason="restricted-publication-input",
                ),
                "recovery-only",
                True,
            )
        if observed_snapshot.identity != expected_identity:
            return PublishResult(
                "reconcile-required",
                None,
                _preserve_reconciliation(
                    recovery_dir,
                    repository_root=repository_root,
                    base=base,
                    current=observed_snapshot.data,
                    candidate=candidate,
                    reason="stale-base",
                ),
                assurance,
                True,
            )
        try:
            validate_pointer_candidate(observed_snapshot.data, candidate)
            capture_authority(
                candidate,
                approved_fence,
                source_bytes,
                repository_root,
                validated_results=validated_results,
                user_authorizations=user_authorizations,
                runtime_receipts=runtime_receipts,
                recovery_snapshot=recovery_snapshot,
                dispatch_ledger=dispatch_ledger,
            )
        except (RpfConflictError, RpfContractError):
            return PublishResult(
                "reconcile-required",
                None,
                _preserve_reconciliation(
                    recovery_dir,
                    repository_root=repository_root,
                    base=base,
                    current=observed_snapshot.data,
                    candidate=candidate,
                    reason="semantic-candidate-conflict",
                ),
                assurance,
                True,
            )
        if not atomic_exchange_available():
            return PublishResult(
                "deferred-provider-unavailable",
                None,
                _preserve_reconciliation(
                    recovery_dir,
                    repository_root=repository_root,
                    base=base,
                    current=observed_snapshot.data,
                    candidate=candidate,
                    reason="atomic-exchange-unavailable",
                ),
                "recovery-only",
                True,
            )
        temp_name = f".rpf.{pointer.name}.{secrets.token_hex(16)}.tmp"
        _write_private_at(active_lock.parent_fd, temp_name, candidate)
        temp_path = pointer.parent / temp_name
        try:
            if not _directory_path_matches_fd(pointer, active_lock.parent_fd):
                return PublishResult(
                    "reconcile-required",
                    None,
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=observed_snapshot.data,
                        candidate=candidate,
                        reason="pointer-parent-identity-changed",
                    ),
                    assurance,
                    True,
                )
            try:
                if not _pointer_lock_owned(active_lock):
                    raise RpfConflictError("pointer lock ownership changed before exchange")
                _atomic_exchange_at(active_lock.parent_fd, pointer.name, temp_name)
            except OSError:
                return PublishResult(
                    "deferred-provider-unavailable",
                    None,
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=_observe_at(active_lock.parent_fd, pointer.name).data,
                        candidate=candidate,
                        reason="atomic-exchange-failed",
                    ),
                    "recovery-only",
                    True,
                )

            displaced = _observe_at(active_lock.parent_fd, temp_name)
            if displaced.identity != expected_identity:
                rollback_failed = False
                try:
                    _atomic_exchange_at(active_lock.parent_fd, pointer.name, temp_name)
                except OSError:
                    rollback_failed = True
                live_path = _retain_live_displaced_at(
                    active_lock.parent_fd,
                    temp_name,
                    temp_path,
                    recovery_dir,
                    "raced-displaced",
                    repository_root=repository_root,
                )
                temp_name = None
                paths = list(
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=displaced.data,
                        candidate=candidate,
                        reason=(
                            "unlocked-writer-race-rollback-failed"
                            if rollback_failed
                            else "unlocked-writer-race"
                        ),
                    )
                )
                paths.append(str(live_path))
                return PublishResult(
                    "reconcile-required", None, tuple(paths), assurance, True
                )
            published_observation = _observe_at(active_lock.parent_fd, pointer.name)
            published = published_observation.identity
            if not _directory_path_matches_fd(pointer, active_lock.parent_fd):
                rollback_failed = False
                try:
                    _atomic_exchange_at(active_lock.parent_fd, pointer.name, temp_name)
                except OSError:
                    rollback_failed = True
                live_path = _retain_live_displaced_at(
                    active_lock.parent_fd,
                    temp_name,
                    temp_path,
                    recovery_dir,
                    "parent-race-displaced",
                    repository_root=repository_root,
                )
                temp_name = None
                paths = list(
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=observed_snapshot.data,
                        candidate=candidate,
                        reason=(
                            "pointer-parent-race-rollback-failed"
                            if rollback_failed
                            else "pointer-parent-race"
                        ),
                    )
                )
                paths.append(str(live_path))
                return PublishResult(
                    "reconcile-required", None, tuple(paths), assurance, True
                )
            if published.sha256 != hashlib.sha256(candidate).hexdigest():
                current = published_observation.data
                live_path = _retain_live_displaced_at(
                    active_lock.parent_fd,
                    temp_name,
                    temp_path,
                    recovery_dir,
                    "readback-mismatch-displaced",
                    repository_root=repository_root,
                )
                temp_name = None
                paths = list(
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=current,
                        candidate=candidate,
                        reason="readback-mismatch",
                    )
                )
                paths.append(str(live_path))
                return PublishResult(
                    "reconcile-required",
                    None,
                    tuple(paths),
                    assurance,
                    True,
                )
            live_path = _retain_live_displaced_at(
                active_lock.parent_fd,
                temp_name,
                temp_path,
                recovery_dir,
                "published-displaced",
                repository_root=repository_root,
            )
            temp_name = None
            try:
                os.fsync(active_lock.parent_fd)
            except OSError:
                # Some otherwise supported filesystems reject directory fsync.
                # The file itself was fsynced before publication; expose the
                # weaker assurance rather than making the workflow unusable.
                assurance += "+no-directory-fsync"
            if (
                not _directory_path_matches_fd(pointer, active_lock.parent_fd)
                or not live_path.is_file()
            ):
                paths = list(
                    _preserve_reconciliation(
                        recovery_dir,
                        repository_root=repository_root,
                        base=base,
                        current=observed_snapshot.data,
                        candidate=candidate,
                        reason="pointer-parent-changed-after-retention",
                    )
                )
                if live_path.is_file():
                    paths.append(str(live_path))
                return PublishResult(
                    "reconcile-required", None, tuple(paths), assurance, True
                )
            return PublishResult(
                "published", published, (str(live_path),), assurance, False
            )
        finally:
            if temp_name is not None:
                try:
                    os.unlink(temp_name, dir_fd=active_lock.parent_fd)
                except FileNotFoundError:
                    pass


def reconciliation_mode(
    *,
    disjoint_or_append_only: bool,
    authored_intent: bool = False,
    locked_content: bool = False,
    destructive_or_high_risk: bool = False,
) -> str:
    """Recommend who should resolve a preserved pointer conflict."""

    flags = (
        disjoint_or_append_only,
        authored_intent,
        locked_content,
        destructive_or_high_risk,
    )
    if any(type(value) is not bool for value in flags):
        raise RpfContractError("reconciliation inputs must be booleans")
    if authored_intent or locked_content or destructive_or_high_risk:
        return "user"
    if disjoint_or_append_only:
        return "auto"
    return "agent"


_PROTECTED_NAME = re.compile(
    r"(?:^|[._-])(?:env|credentials?|secrets?|tokens?|private[-_]?key)(?:$|[._-])",
    re.IGNORECASE,
)
_SECRET_PATTERNS = (
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(rb"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(
        rb"(?i)(?:\\?[\"']\s*)?"
        rb"(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)"
        rb"(?:\s*\\?[\"'])?\s*[:=]\s*"
        rb"(?:\\?[\"'][^\"'\r\n]{8,}\\?[\"']|[^\s#'\"]{8,})"
    ),
)


def _bytes_restricted(data: bytes) -> bool:
    return any(pattern.search(data) for pattern in _SECRET_PATTERNS)


def _reject_json_constant(value: str) -> Any:
    raise RpfContractError(f"non-finite JSON number: {value}")


def _document_restricted(data: bytes) -> bool:
    """Scan raw and decoded JSON so escape sequences cannot hide credentials."""

    if _bytes_restricted(data):
        return True
    # Markdown may contain JSON fragments rather than being one JSON document.
    # Decode JSON unicode escapes in the full byte stream before the raw scan so
    # keys such as ``pass\u0077ord`` cannot hide in trailing projection notes.
    def replace_unicode(match: re.Match[bytes]) -> bytes:
        try:
            return chr(int(match.group(1), 16)).encode("utf-8")
        except (UnicodeEncodeError, ValueError):
            return match.group(0)

    decoded_escapes = re.sub(rb"\\u([0-9a-fA-F]{4})", replace_unicode, data)
    if _bytes_restricted(decoded_escapes):
        return True
    try:
        value = json.loads(
            data.decode("utf-8", errors="strict"),
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
        canonical = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _DuplicateKey,
        RpfContractError,
        RecursionError,
        TypeError,
        ValueError,
    ):
        return False
    return _bytes_restricted(canonical)


def _classification(
    path: str,
    disposition: str,
    reason: str,
    sha256: str | None = None,
    incident_id: str | None = None,
) -> Classification:
    value = _register_identity(
        _CLASSIFICATION_REGISTRY,
        Classification(
            path,
            disposition,
            reason,
            sha256,
            incident_id,
            _CLASSIFICATION_SEAL,
        ),
    )
    _record_fingerprint(
        value,
        value.path,
        value.disposition,
        value.reason,
        value.sha256,
        value.incident_id,
    )
    return value


def _read_repository_file(
    path: Path, repository_root: Path, *, max_bytes: int
) -> bytes:
    root, relative = _repository_relative(path, repository_root)
    if not relative.parts:
        raise RpfContractError("repository file path is incomplete")
    directory_fd, parent = _open_repository_directory(
        root, relative.parts[:-1], create=False
    )
    try:
        data = _read_at(directory_fd, relative.name, max_bytes=max_bytes)
        if not _directory_path_matches_fd(parent / relative.name, directory_fd):
            raise RpfConflictError("repository file parent identity changed")
        return data
    finally:
        os.close(directory_fd)


def classify_path(
    path: Path, *, repository_root: Path, max_bytes: int | None = None
) -> Classification:
    """Classify locally and return disposition metadata without matched bytes."""

    display = os.fspath(path)
    limit = max_bytes if max_bytes is not None else 16 * 1024 * 1024
    if type(limit) is not int or limit < 1:
        return _classification(display, "uninspectable", "metadata:size-limit")
    try:
        root, relative = _repository_relative(path, repository_root)
        if not relative.parts:
            raise RpfContractError("path is not a repository file")
        directory_fd, parent = _open_repository_directory(
            root, relative.parts[:-1], create=False
        )
        try:
            info = os.stat(
                relative.name,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if not _directory_path_matches_fd(parent / relative.name, directory_fd):
                raise RpfConflictError("repository file parent identity changed")
        finally:
            os.close(directory_fd)
    except (OSError, RpfConflictError, RpfContractError, ValueError) as error:
        return _classification(
            display, "uninspectable", f"metadata:{error.__class__.__name__}"
        )
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        return _classification(
            display, "uninspectable", "metadata:not-exact-regular-file"
        )
    if _PROTECTED_NAME.search(path.name):
        return _classification(display, "protected", "metadata:protected-name")
    if info.st_size > limit:
        return _classification(display, "uninspectable", "metadata:size-limit")
    try:
        data = _read_repository_file(path, repository_root, max_bytes=limit)
    except (OSError, RpfConflictError, RpfContractError) as error:
        return _classification(
            display, "uninspectable", f"metadata:{error.__class__.__name__}"
        )
    digest = hashlib.sha256(data).hexdigest()
    if _document_restricted(data):
        return _classification(
            display,
            "restricted",
            "content:credential-pattern",
            incident_id=f"INC-{secrets.token_hex(12)}",
        )
    return _classification(display, "approved", "content:locally-classified", digest)


def read_approved(
    path: Path, classification: Classification, *, repository_root: Path
) -> bytes:
    """Read only bytes that still match their phase-zero approval."""

    if (
        not isinstance(classification, Classification)
        or classification._seal is not _CLASSIFICATION_SEAL
        or not _has_registered_identity(_CLASSIFICATION_REGISTRY, classification)
        or not _fingerprint_matches(
            classification,
            classification.path,
            classification.disposition,
            classification.reason,
            classification.sha256,
            classification.incident_id,
        )
        or classification.disposition != "approved"
        or classification.path != os.fspath(path)
        or not isinstance(classification.sha256, str)
    ):
        raise RpfContractError("path has no matching approval")
    data = _read_repository_file(
        path, repository_root, max_bytes=16 * 1024 * 1024
    )
    if hashlib.sha256(data).hexdigest() != classification.sha256:
        raise RpfConflictError("approved path changed before read")
    return data


_SHELL_INTERPRETERS = {"sh", "bash", "zsh", "fish", "env", "printenv", "set"}
_SHELL_META = re.compile(r"[`$;&|<>\n\r]")
_INLINE_CODE_FLAGS = {"-c", "-e", "--eval", "--execute"}
_INTERPRETERS = {
    "python", "python3", "ruby", "perl", "node", "php", "lua", "osascript"
}
_SAFE_EXECUTABLES = {
    "git", "rg", "grep", "python", "python3", "ruby", "perl", "node",
    "php", "lua", "osascript",
}


def _command_path_metadata_safe(
    path: Path,
    repository_root: Path,
    approvals: Mapping[str, Classification],
) -> bool:
    try:
        root, relative = _repository_relative(path, repository_root)
        if any(_PROTECTED_NAME.search(part) for part in relative.parts):
            return False
        approval = approvals.get(relative.as_posix())
        if approval is None:
            return False
        # Descriptor traversal refuses every symlink component and proves the
        # exact approved bytes still occupy the named repository file.
        return read_approved(
            root / relative,
            approval,
            repository_root=root,
        ) is not None
    except (OSError, RpfContractError, ValueError):
        return False


def safe_command_preflight(
    argv: Sequence[str],
    *,
    repository_root: Path,
    approved_inputs: Sequence[Classification] = (),
) -> tuple[str, ...]:
    """Allow only exact, descriptor-verified files from a classified manifest."""

    if (
        not isinstance(argv, Sequence)
        or isinstance(argv, (str, bytes, bytearray))
        or not argv
        or any(not isinstance(arg, str) or not arg for arg in argv)
    ):
        raise RpfContractError("safe command argv is malformed")
    executable = Path(argv[0]).name.lower()
    if executable.startswith("python3"):
        executable = "python3"
    if executable not in _SAFE_EXECUTABLES:
        raise RpfContractError("executable is outside the safe command allowlist")
    if executable in {"git", "rg", "grep"}:
        raise RpfContractError(
            "repository-aware scanners require a sandboxed host provider"
        )
    if executable in _SHELL_INTERPRETERS or any(_SHELL_META.search(arg) for arg in argv):
        raise RpfContractError("shell expansion and environment commands are forbidden")
    if executable in _INTERPRETERS:
        raise RpfContractError(
            "interpreters can read unclassified files transitively"
        )
    if (
        not isinstance(approved_inputs, Sequence)
        or isinstance(approved_inputs, (str, bytes, bytearray))
        or any(
            not isinstance(item, Classification)
            or item.disposition != "approved"
            or item._seal is not _CLASSIFICATION_SEAL
            or not _has_registered_identity(_CLASSIFICATION_REGISTRY, item)
            for item in approved_inputs
        )
    ):
        raise RpfContractError("command input manifest is malformed")
    try:
        approvals = {
            _repository_relative(Path(item.path), repository_root)[1].as_posix(): item
            for item in approved_inputs
        }
    except (OSError, RpfContractError, ValueError) as error:
        raise RpfContractError("command approval is outside the repository") from error
    if len(approvals) != len(approved_inputs):
        raise RpfContractError("command input manifest contains duplicates")
    lowered = tuple(arg.lower() for arg in argv)
    if any(_PROTECTED_NAME.search(Path(arg).name) for arg in argv[1:]):
        raise RpfContractError("protected path cannot enter command context")
    if executable == "find":
        raise RpfContractError("directory discovery cannot enter command context")
    if any(token in lowered for token in ("--hidden", "--no-ignore")):
        raise RpfContractError("hidden/ignored paths cannot enter broad command context")
    for argument in argv[1:]:
        if argument.startswith("-"):
            continue
        candidate = Path(argument)
        if not candidate.is_absolute():
            candidate = repository_root / candidate
        try:
            exists = candidate.exists() or candidate.is_symlink()
        except OSError:
            exists = True
        if exists and not _command_path_metadata_safe(
            candidate, repository_root, approvals
        ):
            raise RpfContractError("command path lacks an exact classified approval")
    return tuple(argv)


def run_safe_command(
    argv: Sequence[str],
    *,
    repository_root: Path,
    approved_inputs: Sequence[Classification] = (),
    timeout: float = 60.0,
) -> subprocess.CompletedProcess[bytes]:
    """Execute argv without a shell and suppress output if decoded secrets appear."""

    command = safe_command_preflight(
        argv,
        repository_root=repository_root,
        approved_inputs=approved_inputs,
    )
    try:
        completed = subprocess.run(
            command,
            cwd=repository_root.resolve(strict=True),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            env={
                "PATH": "/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": "/dev/null",
            },
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RpfContractError("safe command provider failed") from error
    if _document_restricted(completed.stdout) or _document_restricted(completed.stderr):
        raise RpfContractError("safe command output was restricted and suppressed")
    return completed


def create_if_absent(
    path: Path,
    candidate: bytes,
    *,
    authority: ExecutionAuthority,
    approved_fence: tuple[str, tuple[str, ...], str],
    source_bytes: Mapping[str, bytes],
    repository_root: Path,
    validated_results: Sequence[ValidatedChildResult] = (),
    user_authorizations: Sequence[UserAuthorization] = (),
    runtime_receipts: Sequence[RuntimeReceipt] = (),
    recovery_snapshot: bytes = b"",
    dispatch_ledger: DispatchLedger | None = None,
) -> str:
    """Create a new pointer exclusively; never overwrite a peer."""

    require_mutation_authority(authority, "pointer")
    if not isinstance(candidate, bytes) or _document_restricted(candidate):
        raise RpfContractError("new pointer candidate is invalid or restricted")
    capture_authority(
        candidate,
        approved_fence,
        source_bytes,
        repository_root,
        validated_results=validated_results,
        user_authorizations=user_authorizations,
        runtime_receipts=runtime_receipts,
        recovery_snapshot=recovery_snapshot,
        dispatch_ledger=dispatch_ledger,
    )
    for heading in ("Work queue", "Managed goal-gap index"):
        _revisioned_markdown_rows(candidate, heading)
    root, relative = _repository_relative(path, repository_root)
    directory_fd, _ = _open_repository_directory(
        root, relative.parts[:-1], create=True
    )
    created = False
    try:
        if not _directory_path_matches_fd(path, directory_fd):
            raise RpfConflictError("pointer parent identity changed before create")
        try:
            _write_private_at(directory_fd, relative.name, candidate)
            created = True
        except FileExistsError:
            return "exists"
        os.fsync(directory_fd)
        if (
            not _directory_path_matches_fd(path, directory_fd)
            or _read_at(directory_fd, relative.name, max_bytes=max(len(candidate), 1))
            != candidate
        ):
            if created:
                try:
                    os.unlink(relative.name, dir_fd=directory_fd)
                except OSError:
                    pass
            raise RpfConflictError("pointer parent identity changed during create")
    finally:
        os.close(directory_fd)
    return "created"


def capability_handshake(
    *,
    authority: ExecutionAuthority,
    protected_paths: Iterable[Path],
    pointer_parents: Iterable[Path],
    dispatch_limits: DispatchLimits,
    cancellation_provider: CancellationProvider,
    repository_root: Path,
) -> Mapping[str, Any]:
    dispatch_limits.validate()
    cancellation_provider.validate(execute_probe=True)
    classifications = tuple(
        classify_path(path, repository_root=repository_root)
        for path in protected_paths
    )
    if not classifications or any(
        item.disposition != "approved" for item in classifications
    ):
        raise RpfContractError("phase-zero protected intake did not approve every required path")
    if (
        not isinstance(authority, ExecutionAuthority)
        or authority._seal is not _AUTHORITY_SEAL
        or not _has_registered_identity(_AUTHORITY_REGISTRY, authority)
    ):
        raise RpfContractError("execution authority is not resolved")
    try:
        parents = tuple(Path(parent).resolve(strict=True) for parent in pointer_parents)
    except OSError as error:
        raise RpfContractError("pointer parent is unavailable") from error
    if authority.mode == FULL_MODE and not parents:
        raise RpfContractError("full mode requires authoritative pointer parents")
    exchange = False
    if authority.mode == FULL_MODE and atomic_exchange_available():
        exchange = all(
            atomic_exchange_works(parent)
            for parent in set(parents)
        )
    if authority.mode == FULL_MODE and not exchange:
        raise RpfContractError(
            "full mode requires a conflict-preserving atomic-exchange provider"
        )
    return {
        "mode": authority.mode,
        "atomic_exchange": exchange,
        "pointer_publication": (
            "atomic-exchange" if authority.mode == FULL_MODE else "disabled-audit"
        ),
        "pointer_assurance": (
            "conflict-preserving" if exchange else "read-only-no-publication"
        ),
        "conflict_recovery": True,
        "protected_classifier": True,
        "strict_child_protocol": True,
        "cancellation": {
            "interrupt": True,
            "descendants": True,
            "stream_close": True,
        },
        "dispatch_limits": dataclasses.asdict(dispatch_limits),
        "approved_inputs": classifications,
        "pointer_parents": tuple(os.fspath(parent) for parent in parents),
    }


class _DuplicateKey(RpfContractError):
    pass


def _strict_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKey(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def create_restart_authentication_key() -> bytes:
    """Return an opaque host-held key; callers must never serialize or print it."""

    return secrets.token_bytes(32)


def _restart_key_valid(authentication_key: object) -> bool:
    return bool(
        isinstance(authentication_key, bytes)
        and 32 <= len(authentication_key) <= 1024
    )


def _encode_authenticated_state(
    payload: Mapping[str, Any], *, authentication_key: bytes
) -> bytes:
    if not _restart_key_valid(authentication_key):
        raise RpfContractError("restart authentication key is invalid")
    payload_raw = json.dumps(
        payload, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    authentication = hmac.new(
        authentication_key,
        b"rpf-restart-state-v1\0" + payload_raw,
        hashlib.sha256,
    ).hexdigest()
    return json.dumps(
        {"authentication": authentication, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _decode_authenticated_state(
    raw: bytes,
    *,
    authentication_key: bytes,
    expected_format: str,
) -> Mapping[str, Any]:
    if not isinstance(raw, bytes) or not _restart_key_valid(authentication_key):
        raise RpfContractError("restart state authentication is unavailable")
    try:
        envelope = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
        if (
            not isinstance(envelope, dict)
            or set(envelope) != {"authentication", "payload"}
            or not isinstance(envelope["authentication"], str)
            or re.fullmatch(r"[0-9a-f]{64}", envelope["authentication"]) is None
            or not isinstance(envelope["payload"], dict)
            or envelope["payload"].get("format") != expected_format
        ):
            raise RpfContractError("restart state envelope is malformed")
        payload_raw = json.dumps(
            envelope["payload"], sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        expected = hmac.new(
            authentication_key,
            b"rpf-restart-state-v1\0" + payload_raw,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(envelope["authentication"], expected):
            raise RpfContractError("restart state authentication failed")
        return envelope["payload"]
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _DuplicateKey,
        RecursionError,
        TypeError,
        ValueError,
    ) as error:
        if isinstance(error, RpfContractError):
            raise
        raise RpfContractError("restart state envelope is malformed") from error


_REPORT_FIELDS = {
    "cycle", "total_cycle", "run_id", "pointer_doc", "pointer_rev",
    "pointer_hash", "active_peers", "claim_conflicts", "review_agents",
    "verify_agents", "work_agents", "runnable_units", "local_units",
    "peak_parallel", "serialization_reasons", "prefetch", "new_feedback",
    "goal_gaps", "pending_tasks", "material_pointer_changes", "commits",
    "gate_fixes", "gates_green", "deploy", "source_fence",
    "material_source_changes", "independent_review", "result_falsification",
    "regression_falsification", "source_contract_status", "coverage_gaps",
    "prohibited_checks", "unavailable_checks", "ui_runtime_status",
    "restricted_results", "quarantined_items", "secret_exposure", "status",
    "errors", "summary", "changes", "accepted_dispatch_ids", "coverage",
    "residual_risks",
}


_PAYLOAD_FIELDS = {
    "review": {"findings", "coverage", "residual_risks"},
    "verification": {"verdicts", "coverage", "residual_risks"},
    "aggregate": {"verdict", "findings", "coverage", "residual_risks"},
    "regression": {"verdicts", "coverage", "residual_risks"},
    "source-contract": {"contracts", "coverage", "residual_risks"},
    "ui-runtime": {"ui_rows", "coverage", "residual_risks"},
    "cycle-report": _REPORT_FIELDS,
    "audit-report": _REPORT_FIELDS,
    "restricted": {"incident_id", "obligation_ids"},
    "incomplete": {"reason", "obligation_ids"},
    "needs-scope-expansion": {"paths", "reason"},
}
_KIND_STATUS = {
    "review": {"passed", "findings"},
    "verification": {"passed", "failed"},
    "aggregate": {"passed", "failed"},
    "regression": {"passed", "failed"},
    "source-contract": {"passed", "failed"},
    "ui-runtime": {
        "verified",
        "failed",
        "unverified-prohibited",
        "unverified-unavailable",
        "not-applicable",
    },
    "cycle-report": {"passed", "failed"},
    "audit-report": {"passed", "failed"},
    "restricted": {"restricted"},
    "incomplete": {"incomplete"},
    "needs-scope-expansion": {"incomplete"},
}


def _all_strings(values: object) -> bool:
    return isinstance(values, list) and bool(values) and all(
        isinstance(value, str) and bool(value) for value in values
    )


def _contains_text(value: object, needle: str) -> bool:
    if isinstance(value, str):
        return needle in value
    if isinstance(value, Mapping):
        return any(
            _contains_text(key, needle) or _contains_text(item, needle)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_text(item, needle) for item in value)
    return False


def _freeze_json(value: object) -> object:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    return value


def validated_child_result(value: object) -> bool:
    return bool(
        isinstance(value, ValidatedChildResult)
        and value._seal is _CHILD_RESULT_SEAL
        and _has_registered_identity(_CHILD_RESULT_REGISTRY, value)
        and _fingerprint_matches(
            value,
            hashlib.sha256(value.raw).hexdigest(),
            authority_digest(value.envelope),
        )
    )


def _coverage_valid(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or set(row) != {
            "obligation_id",
            "disposition",
            "evidence",
        }:
            return False
        obligation_id = row.get("obligation_id")
        if (
            not isinstance(obligation_id, str)
            or not obligation_id
            or obligation_id in seen
            or row.get("disposition") not in {"verified", "falsified", "not-applicable"}
            or not _all_strings(row.get("evidence"))
        ):
            return False
        seen.add(obligation_id)
    return True


def _report_coverage_valid(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or set(row) != {
            "obligation_id", "disposition", "evidence",
        }:
            return False
        obligation_id = row.get("obligation_id")
        disposition = row.get("disposition")
        if (
            not isinstance(obligation_id, str)
            or not obligation_id
            or obligation_id in seen
            or disposition
            not in {"verified", "falsified", "not-applicable", "unverified"}
            or not _all_strings(row.get("evidence"))
            or (
                disposition == "unverified"
                and row["evidence"] != [f"missing-accepted-dispatch:{obligation_id}"]
            )
        ):
            return False
        seen.add(obligation_id)
    return True


def _report_payload_shape_valid(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != _REPORT_FIELDS:
        return False
    integer_fields = {
        "cycle", "total_cycle", "pointer_rev", "active_peers",
        "claim_conflicts", "review_agents", "verify_agents", "work_agents",
        "runnable_units", "local_units", "peak_parallel", "new_feedback",
        "goal_gaps", "pending_tasks", "material_pointer_changes",
        "material_source_changes", "coverage_gaps", "restricted_results",
        "quarantined_items", "secret_exposure",
    }
    string_fields = {
        "run_id", "pointer_doc", "pointer_hash", "gates_green", "deploy",
        "independent_review", "result_falsification",
        "regression_falsification", "source_contract_status",
        "ui_runtime_status", "status", "summary",
    }
    list_fields = {
        "serialization_reasons", "prefetch", "commits", "gate_fixes",
        "prohibited_checks", "unavailable_checks", "errors", "changes",
        "accepted_dispatch_ids", "residual_risks",
    }
    return bool(
        all(type(value.get(field)) is int and value[field] >= 0 for field in integer_fields)
        and all(isinstance(value.get(field), str) and value[field] for field in string_fields)
        and value["gates_green"] in {"yes", "no", "not-applicable"}
        and value["status"]
        in {
            "audit-complete", "running", "waiting-user", "waiting-peers",
            "converged", "blocked", "limit-reached",
        }
        and all(isinstance(value.get(field), list) for field in list_fields)
        and _all_strings(value["changes"])
        and all(isinstance(item, str) and item for item in value["accepted_dispatch_ids"])
        and len(value["accepted_dispatch_ids"])
        == len(set(value["accepted_dispatch_ids"]))
        and _report_coverage_valid(value.get("coverage"))
        and isinstance(value.get("source_fence"), dict)
        and set(value["source_fence"]) == {"base", "scope", "hash"}
    )


def decode_child_result(
    raw: bytes,
    *,
    finish_reason: str,
    limits: DispatchLimits,
    controller_canary: str,
) -> ValidatedChildResult:
    limits.validate()
    if finish_reason != "stop":
        raise RpfContractError("child transport did not finish normally")
    if not isinstance(raw, bytes) or not raw or len(raw) > limits.output_bytes:
        raise RpfContractError("child output exceeds its exact byte contract")
    if not controller_canary or controller_canary.encode("utf-8") in raw:
        raise RpfContractError("controller-only material leaked into child output")
    try:
        text = raw.decode("utf-8", errors="strict")
        decoder = json.JSONDecoder(
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
        value, end = decoder.raw_decode(text)
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _DuplicateKey,
        RpfContractError,
        RecursionError,
        TypeError,
        ValueError,
    ) as error:
        raise RpfContractError("malformed child JSON") from error
    if text[end:].strip():
        raise RpfContractError("trailing child output is forbidden")
    try:
        if _contains_text(value, controller_canary):
            raise RpfContractError("controller-only material leaked after JSON decoding")
    except (RecursionError, TypeError, ValueError) as error:
        raise RpfContractError("malformed child JSON structure") from error
    envelope_fields = {
        "protocol_version",
        "kind",
        "status",
        "role_instance",
        "cycle",
        "run_id",
        "dispatch_id",
        "fence",
        "payload",
    }
    if not isinstance(value, dict) or set(value) != envelope_fields:
        raise RpfContractError("child envelope keys are not exact")
    kind = value.get("kind")
    if (
        not isinstance(kind, str)
        or kind not in _PAYLOAD_FIELDS
        or value.get("status") not in _KIND_STATUS[kind]
    ):
        raise RpfContractError("invalid child kind/status")
    if value.get("protocol_version") != PROTOCOL_VERSION:
        raise RpfContractError("unsupported child protocol")
    if type(value.get("cycle")) is not int or value["cycle"] < 0:
        raise RpfContractError("invalid consuming cycle")
    for field in ("role_instance", "run_id", "dispatch_id"):
        if not isinstance(value.get(field), str) or not value[field]:
            raise RpfContractError(f"invalid {field}")
    fence = value.get("fence")
    if not isinstance(fence, dict) or set(fence) != {"base", "scope", "hash"}:
        raise RpfContractError("serialized fence keys are not exact")
    serialized_scope = fence.get("scope")
    if not isinstance(serialized_scope, list) or any(
        not isinstance(path, str) for path in serialized_scope
    ):
        raise RpfContractError("serialized fence scope is malformed")
    shaped_fence = (fence.get("base"), tuple(serialized_scope), fence.get("hash"))
    if not fence_shape_valid(shaped_fence):
        raise RpfContractError("serialized fence is malformed")
    payload = value.get("payload")
    if not isinstance(payload, dict) or set(payload) != _PAYLOAD_FIELDS[kind]:
        raise RpfContractError("child payload keys are not exact")
    if kind in {"restricted", "incomplete"}:
        scalar = "incident_id" if kind == "restricted" else "reason"
        if not isinstance(payload.get(scalar), str) or not payload[scalar]:
            raise RpfContractError("terminal metadata is incomplete")
        if kind == "restricted" and re.fullmatch(
            r"INC-[0-9a-f]{24}", payload["incident_id"]
        ) is None:
            raise RpfContractError("restricted incident ID is not opaque runtime metadata")
        if not _all_strings(payload.get("obligation_ids")):
            raise RpfContractError("terminal obligation IDs are incomplete")
    elif kind == "needs-scope-expansion":
        if not _all_strings(payload.get("paths")) or not isinstance(
            payload.get("reason"), str
        ) or not payload["reason"]:
            raise RpfContractError("scope-expansion request is incomplete")
        if _normalized_scope(payload["paths"]) is None:
            raise RpfContractError("scope-expansion paths are not canonical")
    elif kind in {"cycle-report", "audit-report"}:
        if not _report_payload_shape_valid(payload):
            raise RpfContractError("cycle report payload is incomplete")
    else:
        for field, item in payload.items():
            if field == "verdict":
                if not isinstance(item, str) or not item:
                    raise RpfContractError("aggregate verdict is incomplete")
            elif not isinstance(item, list):
                raise RpfContractError(f"payload field {field} must be a list")
        if not _coverage_valid(payload.get("coverage")):
            raise RpfContractError("atomic coverage evidence is incomplete")
    if _document_restricted(raw):
        raise RpfContractError("child output contains restricted decoded content")
    try:
        result = ValidatedChildResult(_freeze_json(value), raw, _CHILD_RESULT_SEAL)
    except (RecursionError, TypeError, ValueError) as error:
        raise RpfContractError("child JSON could not be frozen") from error
    _register_identity(_CHILD_RESULT_REGISTRY, result)
    _record_fingerprint(
        result,
        hashlib.sha256(result.raw).hexdigest(),
        authority_digest(result.envelope),
    )
    return result


class DispatchLedger:
    TERMINAL = {"completed", "timed-out", "cancelled", "incomplete", "restricted"}

    def __init__(
        self,
        cancellation_provider: CancellationProvider,
        *,
        authority: ExecutionAuthority,
    ) -> None:
        cancellation_provider.validate()
        if (
            cancellation_provider._seal is not _CANCELLATION_PROVIDER_SEAL
            or not _has_registered_identity(
                _CANCELLATION_PROVIDER_REGISTRY, cancellation_provider
            )
            or not _fingerprint_matches(
                cancellation_provider,
                id(cancellation_provider.interrupt),
                id(cancellation_provider.cancel_descendants),
                id(cancellation_provider.close_stream),
                id(cancellation_provider.probe),
                id(cancellation_provider.register_probe),
            )
            or not isinstance(authority, ExecutionAuthority)
            or authority._seal is not _AUTHORITY_SEAL
            or not _has_registered_identity(_AUTHORITY_REGISTRY, authority)
            or not _fingerprint_matches(authority, authority.mode)
        ):
            raise RpfContractError("dispatch ledger authority is unresolved")
        self._cancellation_provider = cancellation_provider
        self._authority = authority
        self._rows: dict[str, dict[str, Any]] = {}
        self._retry_reservations: dict[str, str] = {}
        self._retry_execution_kinds: dict[str, str] = {}
        self._static_authority: dict[str, Mapping[str, Any]] = {}

    def start(
        self,
        dispatch_id: str,
        limits: DispatchLimits,
        *,
        now: float,
        role_instance: str,
        cycle: int,
        run_id: str,
        fence: tuple[str, tuple[str, ...], str],
        retry_of: str | None = None,
        obligation_ids: Sequence[str] = (),
        recovery_action: RecoveryAction | None = None,
        captured_authority: Mapping[str, Any] | None = None,
    ) -> None:
        limits.validate()
        obligations = tuple(obligation_ids)
        reserved_execution_kind = self._retry_execution_kinds.get(dispatch_id)
        controller_static = bool(
            reserved_execution_kind == "controller-static"
            or (
                recovery_action is not None
                and recovery_action.strategy == "controller-static-review"
            )
        )
        if (
            not isinstance(dispatch_id, str)
            or not dispatch_id
            or dispatch_id in self._rows
            or not isinstance(now, (int, float))
            or isinstance(now, bool)
            or not math.isfinite(float(now))
            or not isinstance(role_instance, str)
            or not role_instance
            or type(cycle) is not int
            or (self._authority.mode == AUDIT_MODE and cycle != 0)
            or (self._authority.mode == FULL_MODE and cycle < 1)
            or not isinstance(run_id, str)
            or not run_id
            or not fence_shape_valid(fence)
            or not obligations
            or any(not isinstance(item, str) or not item for item in obligations)
            or len(obligations) != len(set(obligations))
            or (
                dispatch_id.startswith("recovery-")
                and (
                    not _recovery_action_valid(recovery_action)
                    or recovery_action.replacement_id != dispatch_id
                    or recovery_action.cycle != cycle
                    or recovery_action.obligation_ids != obligations
                    or recovery_action.role_instance != role_instance
                    or recovery_action.run_id != run_id
                    or recovery_action.fence != fence
                )
            )
            or (
                recovery_action is not None
                and (
                    not _recovery_action_valid(recovery_action)
                    or not dispatch_id.startswith("recovery-")
                )
            )
            or (
                dispatch_id in self._retry_reservations
                and retry_of != self._retry_reservations[dispatch_id]
            )
            or (
                retry_of is not None
                and (
                    retry_of not in self._rows
                    or self._rows[retry_of].get("retry_dispatch_id") != dispatch_id
                    or self._retry_reservations.get(dispatch_id) != retry_of
                )
            )
            or (
                controller_static
                and (
                    not captured_authority_valid(captured_authority)
                    or captured_authority["root_authority"]["cycle"] != cycle
                    or captured_authority["root_authority"]["run_id"] != run_id
                    or captured_authority["fence"] != fence
                    or role_instance
                    not in captured_authority["required_role_instances"]
                    or tuple(
                        obligation_id
                        for _, obligation_id in coverage_obligations_for_role(
                            captured_authority, role_instance
                        )
                        if obligation_id in set(obligations)
                    )
                    != obligations
                )
            )
            or (not controller_static and captured_authority is not None)
        ):
            raise RpfContractError("dispatch identity/start time is invalid")
        if retry_of is not None:
            origin_expected = self._rows[retry_of]["expected"]
            if (
                role_instance != origin_expected["role_instance"]
                or cycle != origin_expected["cycle"]
                or run_id != origin_expected["run_id"]
                or fence != origin_expected["fence"]
                or obligations != self._rows[retry_of]["obligation_ids"]
            ):
                raise RpfContractError("restricted retry authority differs from origin")
        self._rows[dispatch_id] = {
            "state": "active",
            "deadline": now + float(limits.wall_seconds),
            "limits": limits,
            "cancel_descendants": False,
            "stream_closed": False,
            "expected": {
                "role_instance": role_instance,
                "cycle": cycle,
                "run_id": run_id,
                "dispatch_id": dispatch_id,
                "fence": fence,
            },
            "retry_of": retry_of,
            "restricted_attempts": (
                self._rows[retry_of]["restricted_attempts"]
                if retry_of is not None
                else 0
            ),
            "result_sha256": None,
            "failure_reason": None,
            "obligation_ids": obligations,
            "expected_obligation_ids": obligations,
            "resolved_by": None,
            "host_attached": False,
            "execution_kind": (
                "controller-static" if controller_static else "unclassified"
            ),
            "recovery_binding": (
                {
                    "unit_id": recovery_action.unit_id,
                    "strategy": recovery_action.strategy,
                    "cycle": recovery_action.cycle,
                    "obligation_ids": recovery_action.obligation_ids,
                    "role_instance": recovery_action.role_instance,
                    "run_id": recovery_action.run_id,
                    "fence": recovery_action.fence,
                }
                if recovery_action is not None
                else None
            ),
        }
        if retry_of is not None:
            self._retry_reservations.pop(dispatch_id, None)
            self._retry_execution_kinds.pop(dispatch_id, None)
        if controller_static:
            assert captured_authority is not None
            self._static_authority[dispatch_id] = captured_authority

    def attach_host(
        self, dispatch_id: str, *, pid: int, child_pid: int, stream: Any
    ) -> None:
        """Bind cancellation to the actual dispatcher process tree and stream."""

        row = self._row(dispatch_id)
        registrar = self._cancellation_provider.register_probe
        if (
            row["state"] != "active"
            or row["host_attached"]
            or row["execution_kind"] == "controller-static"
            or not callable(registrar)
        ):
            raise RpfContractError("dispatch host attachment is unavailable")
        registrar(dispatch_id, pid, child_pid, stream)
        row["host_attached"] = True
        row["execution_kind"] = "asynchronous"

    def _terminate_host(self, dispatch_id: str) -> None:
        row = self._row(dispatch_id)
        errors: list[Exception] = []
        for action, callback in (
            ("interrupt", self._cancellation_provider.interrupt),
            ("descendants", self._cancellation_provider.cancel_descendants),
            ("stream_close", self._cancellation_provider.close_stream),
        ):
            try:
                receipt = callback(dispatch_id)
                if not self._cancellation_provider._receipt(
                    receipt, action, dispatch_id
                ):
                    raise RpfContractError("host cancellation receipt is invalid")
            except Exception as error:  # host adapters are an external boundary
                errors.append(error)
        row.update(cancel_descendants=True, stream_closed=True)
        if errors:
            row["state"] = "incomplete"
            raise RpfContractError("host cancellation provider failed") from errors[0]

    def expire(self, dispatch_id: str, *, now: float) -> bool:
        row = self._row(dispatch_id)
        if row["state"] == "active" and now >= row["deadline"]:
            if not row["host_attached"]:
                row["state"] = "incomplete"
                row["failure_reason"] = "provider-unavailable"
                return True
            row["state"] = "timed-out"
            self._terminate_host(dispatch_id)
            row["state"] = "timed-out"
            return True
        return False

    def cancel(self, dispatch_id: str) -> None:
        row = self._row(dispatch_id)
        if row["state"] == "active":
            if not row["host_attached"]:
                row["state"] = "incomplete"
                row["failure_reason"] = "provider-unavailable"
                return
            row["state"] = "cancelled"
            self._terminate_host(dispatch_id)
            row["state"] = "cancelled"

    def accept(
        self, dispatch_id: str, result: ValidatedChildResult, *, now: float
    ) -> None:
        row = self._row(dispatch_id)
        if row["state"] != "active":
            raise RpfContractError("late result rejected for tombstoned dispatch")
        if (
            not isinstance(now, (int, float))
            or isinstance(now, bool)
            or not math.isfinite(float(now))
        ):
            raise RpfContractError("dispatch acceptance time is invalid")
        if now >= row["deadline"]:
            self.expire(dispatch_id, now=now)
            raise RpfContractError("late result rejected at dispatch deadline")
        if not validated_child_result(result):
            raise RpfContractError("dispatch result was not strictly decoded")
        expected = row["expected"]
        serialized_fence = result.envelope.get("fence")
        returned_fence = (
            serialized_fence.get("base"),
            tuple(serialized_fence.get("scope", ())),
            serialized_fence.get("hash"),
        ) if isinstance(serialized_fence, Mapping) else None
        returned = {
            "role_instance": result.envelope.get("role_instance"),
            "cycle": result.envelope.get("cycle"),
            "run_id": result.envelope.get("run_id"),
            "dispatch_id": result.envelope.get("dispatch_id"),
            "fence": returned_fence,
        }
        if returned != expected:
            raise RpfContractError("dispatch result authority mismatch")
        kind = result.envelope.get("kind")
        if row["execution_kind"] == "unclassified":
            row["execution_kind"] = "synchronous"
        if row["execution_kind"] == "controller-static":
            captured = self._static_authority.get(dispatch_id)
            if kind == "restricted":
                row.update(
                    state="incomplete",
                    stream_closed=True,
                    failure_reason="controller-static-restricted",
                    result_sha256=hashlib.sha256(result.raw).hexdigest(),
                )
                raise RpfContractError(
                    "controller-static recovery cannot call a filtered provider"
                )
            if kind not in {"incomplete", "needs-scope-expansion"}:
                role = expected["role_instance"]
                authoritative_pairs = coverage_obligations_for_role(captured, role)
                obligation_set = set(row["expected_obligation_ids"])
                expected_pairs = tuple(
                    pair for pair in authoritative_pairs if pair[1] in obligation_set
                )
                if not _coverage_evidence_valid(
                    captured,
                    role,
                    result,
                    expected_pairs=expected_pairs,
                ):
                    row.update(
                        state="incomplete",
                        stream_closed=True,
                        failure_reason="invalid-coverage",
                    )
                    raise RpfContractError(
                        "controller-static recovery lacks exact source evidence"
                    )
        if kind == "restricted":
            row["restricted_attempts"] += 1
            state = "restricted"
            returned_obligations = tuple(
                result.envelope["payload"].get("obligation_ids", ())
            )
            if (
                row["expected_obligation_ids"]
                and returned_obligations != row["expected_obligation_ids"]
            ):
                row["state"] = "incomplete"
                raise RpfContractError("restricted result changed atomic obligations")
            row["obligation_ids"] = returned_obligations
        elif kind in {"incomplete", "needs-scope-expansion"}:
            state = "incomplete"
            row["failure_reason"] = result.envelope["payload"].get(
                "reason", "needs-scope-expansion"
            )
        else:
            state = "completed"
            returned_obligations = tuple(
                coverage.get("obligation_id")
                for coverage in result.envelope["payload"].get("coverage", ())
            )
            if (
                row["expected_obligation_ids"]
                and returned_obligations != row["expected_obligation_ids"]
            ):
                row["state"] = "incomplete"
                row["failure_reason"] = "invalid-coverage"
                raise RpfContractError("dispatch returned non-exact atomic coverage")
            row["obligation_ids"] = returned_obligations
        row.update(
            state=state,
            stream_closed=True,
            result_sha256=hashlib.sha256(result.raw).hexdigest(),
        )
        retry_of = row.get("retry_of")
        if retry_of is not None and state == "completed":
            origin = self._row(retry_of)
            if tuple(row["obligation_ids"]) != tuple(origin["obligation_ids"]):
                row["state"] = "incomplete"
                raise RpfContractError("restricted retry did not close exact obligations")
            while True:
                origin["resolved_by"] = dispatch_id
                ancestor = origin.get("retry_of")
                if ancestor is None:
                    break
                origin = self._row(ancestor)

    def transition_restricted(
        self,
        dispatch_id: str,
        *,
        retry_dispatch_id: str,
        sanitization_preserves_obligation: bool,
    ) -> RestrictedTransition:
        row = self._row(dispatch_id)
        if row["state"] != "restricted" or row.get("retry_dispatch_id") is not None:
            return RestrictedTransition("quarantined", False, "continue")
        retry_origin = row.get("retry_of")
        if (
            retry_origin is not None
            and self._row(retry_origin).get("quarantined") is True
        ):
            row["quarantined"] = True
            if (
                not isinstance(retry_dispatch_id, str)
                or not retry_dispatch_id
                or retry_dispatch_id in self._rows
                or retry_dispatch_id in self._retry_reservations
            ):
                raise RpfContractError("restricted retry identity is invalid")
            row["retry_dispatch_id"] = retry_dispatch_id
            self._retry_reservations[retry_dispatch_id] = dispatch_id
            self._retry_execution_kinds[retry_dispatch_id] = "controller-static"
            return RestrictedTransition(
                "controller-static-recovery", True, "continue"
            )
        transition = _restricted_transition(
            previous_restricted_attempts=row["restricted_attempts"] - 1,
            sanitization_preserves_obligation=sanitization_preserves_obligation,
        )
        if (
            not isinstance(retry_dispatch_id, str)
            or not retry_dispatch_id
            or retry_dispatch_id in self._rows
            or retry_dispatch_id in self._retry_reservations
        ):
            raise RpfContractError("restricted retry identity is invalid")
        row["retry_dispatch_id"] = retry_dispatch_id
        self._retry_reservations[retry_dispatch_id] = dispatch_id
        if transition.retry_allowed:
            self._retry_execution_kinds[retry_dispatch_id] = "external"
            return transition
        row["quarantined"] = True
        self._retry_execution_kinds[retry_dispatch_id] = "controller-static"
        return RestrictedTransition("controller-static-recovery", True, "continue")

    def publication_authorized(
        self, dispatch_id: str, result: ValidatedChildResult
    ) -> bool:
        row = self._row(dispatch_id)
        return bool(
            validated_child_result(result)
            and row["state"] == "completed"
            and row["result_sha256"] == hashlib.sha256(result.raw).hexdigest()
        )

    def snapshot(self, dispatch_id: str) -> Mapping[str, Any]:
        return dict(self._row(dispatch_id))

    def export_state(self, *, authentication_key: bytes) -> bytes:
        """Persist an authenticated restart-safe ledger without host handles."""

        rows: dict[str, Any] = {}
        for dispatch_id, source in sorted(self._rows.items()):
            row = copy.deepcopy(source)
            if row["state"] == "active":
                row["state"] = "incomplete"
                row["failure_reason"] = "provider-unavailable"
            limits = row.pop("limits")
            row["limits"] = {
                "wall_seconds": limits.wall_seconds,
                "output_bytes": limits.output_bytes,
                "context_bytes": limits.context_bytes,
            }
            row["host_attached"] = False
            row["expected"]["fence"] = [
                row["expected"]["fence"][0],
                list(row["expected"]["fence"][1]),
                row["expected"]["fence"][2],
            ]
            for field in ("obligation_ids", "expected_obligation_ids"):
                row[field] = list(row[field])
            if row["recovery_binding"] is not None:
                row["recovery_binding"]["obligation_ids"] = list(
                    row["recovery_binding"]["obligation_ids"]
                )
            rows[dispatch_id] = row
        return _encode_authenticated_state(
            {"format": "rpf-dispatch-ledger-v2", "rows": rows},
            authentication_key=authentication_key,
        )

    @classmethod
    def from_state(
        cls,
        raw: bytes,
        *,
        authentication_key: bytes,
        cancellation_provider: CancellationProvider,
        authority: ExecutionAuthority,
    ) -> "DispatchLedger":
        try:
            value = _decode_authenticated_state(
                raw,
                authentication_key=authentication_key,
                expected_format="rpf-dispatch-ledger-v2",
            )
            if (
                not isinstance(value, dict)
                or set(value) != {"format", "rows"}
                or value["format"] != "rpf-dispatch-ledger-v2"
                or not isinstance(value["rows"], dict)
            ):
                raise RpfContractError("dispatch ledger snapshot is malformed")
            ledger = cls(cancellation_provider, authority=authority)
            expected_fields = {
                "state", "deadline", "limits", "cancel_descendants",
                "stream_closed", "expected", "retry_of", "restricted_attempts",
                "result_sha256", "failure_reason", "obligation_ids",
                "expected_obligation_ids", "resolved_by", "host_attached",
                "execution_kind", "recovery_binding", "retry_dispatch_id",
                "quarantined",
            }
            for dispatch_id, serialized in value["rows"].items():
                if not isinstance(serialized, dict):
                    raise RpfContractError("dispatch ledger row is malformed")
                row = dict(serialized)
                row.setdefault("retry_dispatch_id", None)
                row.setdefault("quarantined", False)
                if set(row) != expected_fields:
                    raise RpfContractError("dispatch ledger row keys are not exact")
                expected = row["expected"]
                limits_data = row["limits"]
                if (
                    not isinstance(dispatch_id, str)
                    or not dispatch_id
                    or row["state"] not in cls.TERMINAL
                    or type(row["deadline"]) not in {int, float}
                    or not isinstance(expected, dict)
                    or set(expected)
                    != {"role_instance", "cycle", "run_id", "dispatch_id", "fence"}
                    or expected["dispatch_id"] != dispatch_id
                    or not isinstance(expected["role_instance"], str)
                    or not expected["role_instance"]
                    or type(expected["cycle"]) is not int
                    or (
                        authority.mode == AUDIT_MODE and expected["cycle"] != 0
                    )
                    or (
                        authority.mode == FULL_MODE and expected["cycle"] < 1
                    )
                    or not isinstance(expected["run_id"], str)
                    or not expected["run_id"]
                    or not isinstance(expected["fence"], list)
                    or len(expected["fence"]) != 3
                    or not isinstance(expected["fence"][1], list)
                    or not isinstance(limits_data, dict)
                    or set(limits_data)
                    != {"wall_seconds", "output_bytes", "context_bytes"}
                    or not _all_strings(row["obligation_ids"])
                    or not row["obligation_ids"]
                    or len(row["obligation_ids"])
                    != len(set(row["obligation_ids"]))
                    or row["obligation_ids"] != row["expected_obligation_ids"]
                    or row["host_attached"] is not False
                    or row["execution_kind"]
                    not in {
                        "synchronous", "asynchronous", "controller-static",
                        "unclassified",
                    }
                    or (
                        row["execution_kind"] == "asynchronous"
                        and row["state"] == "completed"
                        and not row["stream_closed"]
                    )
                    or type(row["cancel_descendants"]) is not bool
                    or type(row["stream_closed"]) is not bool
                    or type(row["restricted_attempts"]) is not int
                    or row["restricted_attempts"] < 0
                    or type(row["quarantined"]) is not bool
                    or (
                        row["result_sha256"] is not None
                        and (
                            not isinstance(row["result_sha256"], str)
                            or re.fullmatch(r"[0-9a-f]{64}", row["result_sha256"])
                            is None
                        )
                    )
                    or (
                        row["failure_reason"] is not None
                        and (
                            not isinstance(row["failure_reason"], str)
                            or not row["failure_reason"]
                        )
                    )
                    or (
                        row["retry_of"] is not None
                        and (
                            not isinstance(row["retry_of"], str)
                            or not row["retry_of"]
                        )
                    )
                    or (
                        row["retry_dispatch_id"] is not None
                        and (
                            not isinstance(row["retry_dispatch_id"], str)
                            or not row["retry_dispatch_id"]
                        )
                    )
                    or (
                        row["resolved_by"] is not None
                        and (
                            not isinstance(row["resolved_by"], str)
                            or not row["resolved_by"]
                        )
                    )
                    or (
                        row["state"] in {"completed", "restricted"}
                        and row["result_sha256"] is None
                    )
                    or (
                        row["state"] == "restricted"
                        and row["restricted_attempts"] < 1
                    )
                ):
                    raise RpfContractError("dispatch ledger row authority is invalid")
                fence = (
                    expected["fence"][0],
                    tuple(expected["fence"][1]),
                    expected["fence"][2],
                )
                if not fence_shape_valid(fence):
                    raise RpfContractError("dispatch ledger fence is invalid")
                limits = DispatchLimits(**limits_data)
                limits.validate()
                binding = row["recovery_binding"]
                if binding is not None:
                    if (
                        not isinstance(binding, dict)
                        or set(binding)
                        != {
                            "unit_id", "strategy", "cycle", "obligation_ids",
                            "role_instance", "run_id", "fence",
                        }
                        or not isinstance(binding["unit_id"], str)
                        or not binding["unit_id"]
                        or not isinstance(binding["strategy"], str)
                        or not binding["strategy"]
                        or binding["cycle"] != expected["cycle"]
                        or binding["obligation_ids"] != row["obligation_ids"]
                        or binding["role_instance"] != expected["role_instance"]
                        or binding["run_id"] != expected["run_id"]
                        or binding["fence"] != expected["fence"]
                    ):
                        raise RpfContractError(
                            "dispatch recovery binding is malformed"
                        )
                    binding["obligation_ids"] = tuple(binding["obligation_ids"])
                    binding["fence"] = fence
                if dispatch_id.startswith("recovery-") != (binding is not None):
                    raise RpfContractError(
                        "dispatch recovery identity is not authenticated"
                    )
                row["expected"] = {**expected, "fence": fence}
                row["limits"] = limits
                row["obligation_ids"] = tuple(row["obligation_ids"])
                row["expected_obligation_ids"] = tuple(
                    row["expected_obligation_ids"]
                )
                row["recovery_binding"] = binding
                ledger._rows[dispatch_id] = row
            for dispatch_id, row in ledger._rows.items():
                if (
                    row["retry_of"] is not None
                    and row["retry_of"] not in ledger._rows
                ):
                    raise RpfContractError("dispatch retry origin is missing")
                if row["retry_of"] is not None:
                    origin = ledger._rows[row["retry_of"]]
                    if origin.get("retry_dispatch_id") != dispatch_id:
                        raise RpfContractError(
                            "dispatch retry is not bound to its origin"
                        )
                retry_dispatch_id = row.get("retry_dispatch_id")
                if retry_dispatch_id is not None:
                    if row["state"] != "restricted":
                        raise RpfContractError(
                            "only a restricted dispatch can own a retry"
                        )
                    retry_row = ledger._rows.get(retry_dispatch_id)
                    if retry_row is None:
                        if retry_dispatch_id in ledger._retry_reservations:
                            raise RpfContractError(
                                "dispatch retry reservation is duplicated"
                            )
                        ledger._retry_reservations[retry_dispatch_id] = dispatch_id
                        ledger._retry_execution_kinds[retry_dispatch_id] = (
                            "controller-static"
                            if row.get("quarantined") is True
                            else "external"
                        )
                    elif retry_row.get("retry_of") != dispatch_id:
                        raise RpfContractError(
                            "dispatch retry reservation has a different origin"
                        )
                    elif row.get("quarantined") is True and retry_row.get(
                        "execution_kind"
                    ) != "controller-static":
                        raise RpfContractError(
                            "quarantined retry is not controller-static"
                        )
                if row.get("resolved_by") is not None:
                    resolver = ledger._rows.get(row["resolved_by"])
                    ancestry: set[str] = set()
                    cursor = resolver
                    while cursor is not None and cursor.get("retry_of") is not None:
                        ancestry.add(cursor["retry_of"])
                        cursor = ledger._rows.get(cursor["retry_of"])
                    if (
                        row["state"] != "restricted"
                        or resolver is None
                        or resolver.get("state") != "completed"
                        or dispatch_id not in ancestry
                    ):
                        raise RpfContractError(
                            "restricted resolution is not terminally evidenced"
                        )
            return ledger
        except (
            UnicodeDecodeError, json.JSONDecodeError, _DuplicateKey,
            RecursionError, TypeError, ValueError,
        ) as error:
            if isinstance(error, RpfContractError):
                raise
            raise RpfContractError("dispatch ledger snapshot is malformed") from error

    def barrier_terminal(self, dispatch_ids: Iterable[str]) -> bool:
        ids = tuple(dispatch_ids)
        return bool(ids) and all(self._row(item)["state"] in self.TERMINAL for item in ids)

    def unresolved_restricted_obligations(self) -> tuple[str, ...]:
        obligations = {
            obligation
            for row in self._rows.values()
            if row["state"] == "restricted" and row.get("resolved_by") is None
            for obligation in row.get("obligation_ids", ())
        }
        return tuple(sorted(obligations, key=lambda value: value.encode("utf-8")))

    def launch_telemetry(
        self, captured_authority: Mapping[str, Any]
    ) -> Mapping[str, int]:
        """Count exact-fence dispatch launches by their authoritative role class."""

        if not captured_authority_valid(captured_authority):
            raise RpfContractError("launch telemetry authority is invalid")
        root = captured_authority["root_authority"]
        required_roles = set(captured_authority["required_role_instances"])
        verifier_roles = {
            "aggregate-result-falsifier",
            "source-contract-verifier",
            "ui-runtime-verifier",
            "regression-falsifier",
        }
        counts = {"review": 0, "verify": 0, "work": 0, "local": 0}
        for row in self._rows.values():
            expected = row["expected"]
            role = expected["role_instance"]
            if (
                expected["cycle"] != root["cycle"]
                or expected["run_id"] != root["run_id"]
                or expected["fence"] != captured_authority["fence"]
            ):
                continue
            execution_kind = row.get("execution_kind")
            externally_launched = bool(
                execution_kind == "asynchronous"
                and (row["host_attached"] or row["state"] != "active")
                or execution_kind == "synchronous" and row["state"] != "active"
            )
            if execution_kind == "controller-static":
                if row["state"] != "active":
                    counts["local"] += 1
                continue
            if not externally_launched:
                continue
            if role in verifier_roles:
                counts["verify"] += 1
            elif role in required_roles:
                counts["review"] += 1
            elif role.startswith(("implementation-worker:", "work-agent:")):
                counts["work"] += 1
        return counts

    def _row(self, dispatch_id: str) -> dict[str, Any]:
        try:
            return self._rows[dispatch_id]
        except KeyError as error:
            raise RpfContractError("unknown dispatch") from error


class TechnicalRecoveryLedger:
    """Keep infrastructure failures recoverable and out of semantic blockers.

    The ledger contains safe failure classes and attempted strategies only. It
    never accepts repository bytes, credentials, exception text, or findings,
    and it deliberately has no transition to ``blocked``.
    """

    _STRATEGIES: Mapping[str, tuple[str, ...]] = MappingProxyType(
        {
            "bundle-refresh": (
                "retry-bundle-pin",
                "pin-verified-ancestor-bundle",
            ),
            "runtime-import": (
                "discard-snapshot-and-repin",
                "pin-verified-ancestor-bundle",
            ),
            "classifier-provider": (
                "reprobe-classifier",
                "metadata-only-continuity",
            ),
            "cancellation-provider": (
                "reprobe-cancellation",
                "controller-local-no-child",
            ),
            "atomic-exchange-provider": (
                "reprobe-atomic-exchange",
                "read-only-shadow-cycle",
            ),
            "child-provider": (
                "redispatch-smaller-context",
                "controller-static-review",
            ),
            "lock-contention": (
                "bounded-lock-backoff",
                "read-only-shadow-cycle",
            ),
            "filesystem-io": (
                "new-private-workspace",
                "read-only-shadow-cycle",
            ),
            "gate-tooling": (
                "repair-tool-resolution",
                "source-contract-with-runtime-residual",
            ),
            "git-integration": (
                "dedicated-integration-worktree",
                "preserve-green-commit-for-retry",
            ),
            "credential-or-signing": (
                "preserve-green-commit-for-retry",
            ),
            "push": (
                "fetch-rebase-owned-scope-and-rerun-gates",
                "preserve-green-commit-for-retry",
            ),
            "deployment": (
                "defer-deployment-and-continue",
            ),
        }
    )

    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}

    @classmethod
    def failure_kinds(cls) -> tuple[str, ...]:
        return tuple(cls._STRATEGIES)

    def record_failure(self, *, failure_kind: str) -> str:
        if failure_kind not in self._STRATEGIES:
            raise RpfContractError("technical failure metadata is invalid")
        failure_id = "TECH-" + failure_kind.upper()
        existing = self._rows.get(failure_id)
        if existing is not None:
            if existing["failure_kind"] != failure_kind:
                raise RpfContractError("technical failure identity changed")
            existing["observations"] += 1
            existing["resolved"] = False
            return failure_id
        self._rows[failure_id] = {
            "failure_kind": failure_kind,
            "observations": 1,
            "attempted": [],
            "carry_count": 0,
            "pending_attempt_id": None,
            "resolved": False,
        }
        return failure_id

    def next_action(self, failure_id: str) -> TechnicalRecoveryAction | None:
        row = self._row(failure_id)
        if row["resolved"]:
            return None
        if row["pending_attempt_id"] is not None:
            raise RpfContractError("technical recovery action is already pending")
        strategies = self._STRATEGIES[row["failure_kind"]]
        attempted = row["attempted"]
        if len(attempted) < len(strategies):
            strategy = strategies[len(attempted)]
            attempted.append(strategy)
        else:
            strategy = "carry-forward-retry"
            row["carry_count"] += 1
        attempt_id = f"rpf-tech-{secrets.token_hex(16)}"
        row["pending_attempt_id"] = attempt_id
        return _issue_technical_recovery_action(failure_id, attempt_id, strategy)

    def finish_action(
        self, action: TechnicalRecoveryAction, *, recovered: bool
    ) -> None:
        if (
            not _technical_recovery_action_valid(action)
            or type(recovered) is not bool
        ):
            raise RpfContractError("technical recovery action is invalid")
        row = self._row(action.failure_id)
        if row["pending_attempt_id"] != action.attempt_id or row["resolved"]:
            raise RpfContractError("technical recovery action is stale")
        row["pending_attempt_id"] = None
        _TECHNICAL_RECOVERY_ACTION_REGISTRY.pop(id(action), None)
        _ISSUED_FINGERPRINTS.pop(id(action), None)
        if recovered:
            row["resolved"] = True

    def unresolved_failures(self) -> tuple[str, ...]:
        return tuple(
            failure_id
            for failure_id, row in self._rows.items()
            if not row["resolved"]
        )

    def run_status(self, *, invocation_limit_reached: bool = False) -> str:
        if type(invocation_limit_reached) is not bool:
            raise RpfContractError("technical continuation status is invalid")
        if not self.unresolved_failures():
            return "recovery-clear"
        return "limit-reached" if invocation_limit_reached else "running"

    def snapshot(self) -> bytes:
        return json.dumps(
            {
                "format": "rpf-technical-recovery-v1",
                "rows": self._rows,
            },
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

    def _row(self, failure_id: str) -> dict[str, Any]:
        try:
            return self._rows[failure_id]
        except (KeyError, TypeError) as error:
            raise RpfContractError("unknown technical failure") from error


class AdaptiveRecoveryLedger:
    """Turn review barrier failures into new work instead of a stalled stop.

    Failed child bytes and unverified findings are deliberately not accepted by
    this ledger.  It stores only unit identity, exact obligation IDs, failure
    class, and which materially different recovery strategies were attempted.
    """

    _STRATEGIES = {
        "timed-out": (
            "redispatch-smaller-context",
            "split-atomic-obligations",
            "controller-static-review",
        ),
        "invalid-coverage": (
            "schema-repair-redispatch",
            "split-atomic-obligations",
            "controller-static-review",
        ),
        "provider-unavailable": (
            "controller-static-review",
        ),
        "malformed": (
            "schema-repair-redispatch",
            "split-atomic-obligations",
            "controller-static-review",
        ),
    }

    def __init__(self, *, total_cycles: int, start_cycle: int = 1) -> None:
        if (
            type(total_cycles) is not int
            or not 1 <= total_cycles <= 128
            or type(start_cycle) is not int
            or start_cycle < 1
        ):
            raise RpfContractError("recovery cycle budget is invalid")
        self._total_cycles = total_cycles
        self._start_cycle = start_cycle
        self._limit_cycle = start_cycle + total_cycles - 1
        self._rows: dict[str, dict[str, Any]] = {}

    def record_failure(
        self,
        unit_id: str,
        *,
        obligation_ids: Sequence[str],
        failure_kind: str,
        cycle: int,
        failed_dispatch_id: str,
        dispatch_ledger: DispatchLedger,
        captured_authority: Mapping[str, Any],
    ) -> None:
        obligations = tuple(obligation_ids)
        if isinstance(dispatch_ledger, DispatchLedger):
            try:
                failed_dispatch = dispatch_ledger.snapshot(failed_dispatch_id)
            except (KeyError, RpfContractError):
                failed_dispatch = {}
        else:
            failed_dispatch = {}
        failed_state = failed_dispatch.get("state")
        failed_expected = failed_dispatch.get("expected", {})
        failed_role = failed_expected.get("role_instance")
        used_failure_dispatches = {
            row["failed_dispatch_id"] for row in self._rows.values()
        }
        reason_for_kind = {
            "invalid-coverage": "invalid-coverage",
            "provider-unavailable": "provider-unavailable",
            "malformed": "malformed",
        }
        if (
            not isinstance(unit_id, str)
            or not unit_id
            or unit_id in self._rows
            or failure_kind not in self._STRATEGIES
            or type(cycle) is not int
            or cycle < self._start_cycle
            or cycle > self._limit_cycle
            or not obligations
            or any(not isinstance(item, str) or not item for item in obligations)
            or len(obligations) != len(set(obligations))
            or not isinstance(failed_dispatch_id, str)
            or not failed_dispatch_id
            or not isinstance(dispatch_ledger, DispatchLedger)
            or not captured_authority_valid(captured_authority)
            or failed_dispatch_id in used_failure_dispatches
            or failed_state not in {"timed-out", "incomplete"}
            or failed_expected.get("cycle") != cycle
            or failed_expected.get("run_id")
            != captured_authority["root_authority"]["run_id"]
            or failed_expected.get("fence") != captured_authority["fence"]
            or failed_role not in captured_authority["required_role_instances"]
            or failed_dispatch.get("expected_obligation_ids") != obligations
            or tuple(
                obligation_id
                for _, obligation_id in coverage_obligations_for_role(
                    captured_authority, failed_role
                )
                if obligation_id in set(obligations)
            )
            != obligations
            or (
                failure_kind == "timed-out" and failed_state != "timed-out"
            )
            or (
                failure_kind != "timed-out"
                and (
                    failed_state != "incomplete"
                    or failed_dispatch.get("failure_reason")
                    != reason_for_kind[failure_kind]
                )
            )
        ):
            raise RpfContractError("recovery failure record is malformed")
        self._rows[unit_id] = {
            "failure_kind": failure_kind,
            "failed_dispatch_id": failed_dispatch_id,
            "failure_cycle": cycle,
            "role_instance": failed_role,
            "run_id": failed_expected["run_id"],
            "fence": failed_expected["fence"],
            "obligation_ids": obligations,
            "attempted": [],
            "accepted": False,
            "last_carry_cycle": None,
            "pending_replacement_id": None,
            "pending_strategy": None,
            "pending_cycle": None,
            "accepted_result_sha256": None,
            "accepted_dispatch_id": None,
            "accepted_cycle": None,
            "transition_history": [],
        }

    def next_action(self, unit_id: str) -> RecoveryAction | None:
        row = self._row(unit_id)
        if row["accepted"]:
            return None
        if row["pending_replacement_id"] is not None:
            return _issue_recovery_action(
                unit_id,
                row["pending_replacement_id"],
                row["pending_strategy"],
                row["obligation_ids"],
                row["pending_cycle"],
                row["role_instance"],
                row["run_id"],
                row["fence"],
            )
        strategies = self._STRATEGIES[row["failure_kind"]]
        index = len(row["attempted"])
        if index >= len(strategies):
            return None
        strategy = strategies[index]
        row["attempted"].append(strategy)
        replacement_id = f"recovery-{secrets.token_hex(16)}"
        row["pending_replacement_id"] = replacement_id
        row["pending_strategy"] = strategy
        row["pending_cycle"] = row["failure_cycle"]
        row["transition_history"].append({
            "strategy": strategy,
            "dispatch_id": replacement_id,
            "cycle": row["failure_cycle"],
            "terminal_state": "pending",
        })
        return _issue_recovery_action(
            unit_id,
            replacement_id,
            strategy,
            row["obligation_ids"],
            row["pending_cycle"],
            row["role_instance"],
            row["run_id"],
            row["fence"],
        )

    def accept_exact_coverage(
        self,
        unit_id: str,
        *,
        result: ValidatedChildResult,
        dispatch_ledger: DispatchLedger,
        captured_authority: Mapping[str, Any],
    ) -> None:
        row = self._row(unit_id)
        role = result.envelope.get("role_instance") if validated_child_result(result) else None
        if (
            not validated_child_result(result)
            or not captured_authority_valid(captured_authority)
            or result.envelope.get("dispatch_id") != row["pending_replacement_id"]
            or result.envelope.get("cycle") != row["pending_cycle"]
            or not dispatch_ledger.publication_authorized(
                result.envelope.get("dispatch_id"), result
            )
            or result.envelope.get("cycle")
            != captured_authority["root_authority"]["cycle"]
            or result.envelope.get("run_id")
            != captured_authority["root_authority"]["run_id"]
            or result.envelope.get("role_instance")
            != row["role_instance"]
            or dispatch_ledger.snapshot(
                result.envelope.get("dispatch_id")
            ).get("expected_obligation_ids")
            != row["obligation_ids"]
        ):
            raise RpfContractError("recovery result authority is invalid")
        authoritative_pairs = coverage_obligations_for_role(
            captured_authority, role
        )
        authoritative = tuple(
            obligation_id for _, obligation_id in authoritative_pairs
        )
        row_set = set(row["obligation_ids"])
        if (
            any(obligation not in authoritative for obligation in row_set)
            or tuple(item for item in authoritative if item in row_set)
            != row["obligation_ids"]
        ):
            raise RpfContractError("recovery obligations are not captured authority")
        serialized_fence = result.envelope.get("fence")
        result_fence = (
            serialized_fence.get("base"),
            tuple(serialized_fence.get("scope", ())),
            serialized_fence.get("hash"),
        ) if isinstance(serialized_fence, Mapping) else None
        if result_fence != captured_authority.get("fence"):
            raise RpfContractError("recovery result fence is stale")
        coverage = result.envelope.get("payload", {}).get("coverage", ())
        returned = tuple(item.get("obligation_id") for item in coverage)
        if (
            returned != row["obligation_ids"]
            or len(returned) != len(set(returned))
            or not _coverage_evidence_valid(
                captured_authority,
                role,
                result,
                expected_pairs=tuple(
                    pair
                    for pair in authoritative_pairs
                    if pair[1] in row_set
                ),
            )
        ):
            raise RpfContractError("atomic coverage evidence is incomplete")
        row["accepted"] = True
        row["accepted_result_sha256"] = hashlib.sha256(result.raw).hexdigest()
        row["accepted_dispatch_id"] = result.envelope["dispatch_id"]
        row["accepted_cycle"] = result.envelope["cycle"]
        row["transition_history"][-1]["terminal_state"] = "completed"
        row["pending_replacement_id"] = None
        row["pending_strategy"] = None
        row["pending_cycle"] = None

    def record_replacement_failure(
        self,
        unit_id: str,
        *,
        replacement_id: str,
        dispatch_ledger: DispatchLedger,
        captured_authority: Mapping[str, Any],
    ) -> None:
        row = self._row(unit_id)
        if (
            row["accepted"]
            or replacement_id != row["pending_replacement_id"]
            or row["pending_strategy"] is None
            or not isinstance(dispatch_ledger, DispatchLedger)
            or not captured_authority_valid(captured_authority)
        ):
            raise RpfContractError("recovery replacement failure is stale")
        dispatch = dispatch_ledger.snapshot(replacement_id)
        expected = dispatch.get("expected", {})
        authoritative_role = expected.get("role_instance")
        try:
            role_obligations = tuple(
                obligation_id
                for _, obligation_id in coverage_obligations_for_role(
                    captured_authority, authoritative_role
                )
            )
        except RpfContractError as error:
            raise RpfContractError(
                "recovery replacement lacks authoritative role evidence"
            ) from error
        state = dispatch.get("state")
        if (
            state not in {"timed-out", "cancelled", "incomplete"}
            or expected.get("cycle") != row["pending_cycle"]
            or authoritative_role != row["role_instance"]
            or expected.get("run_id")
            != captured_authority["root_authority"]["run_id"]
            or expected.get("fence") != captured_authority["fence"]
            or dispatch.get("expected_obligation_ids") != row["obligation_ids"]
            or tuple(
                item for item in role_obligations if item in set(row["obligation_ids"])
            )
            != row["obligation_ids"]
        ):
            raise RpfContractError("recovery replacement lacks terminal failure evidence")
        row["transition_history"][-1]["terminal_state"] = state
        row["pending_replacement_id"] = None
        row["pending_strategy"] = None
        row["pending_cycle"] = None

    def carry_to_cycle(self, unit_id: str, *, cycle: int) -> RecoveryAction:
        """Create one continuation identity per later cycle after strategies end."""

        row = self._row(unit_id)
        if (
            row["accepted"]
            or type(cycle) is not int
            or cycle < 1
            or cycle > self._limit_cycle
            or cycle
            != (
                row["last_carry_cycle"] + 1
                if row["last_carry_cycle"] is not None
                else row["failure_cycle"] + 1
            )
            or len(row["attempted"])
            < len(self._STRATEGIES[row["failure_kind"]])
            or row["pending_replacement_id"] is not None
        ):
            raise RpfContractError("recovery carry transition is invalid")
        row["last_carry_cycle"] = cycle
        replacement_id = f"recovery-{secrets.token_hex(16)}"
        row["pending_replacement_id"] = replacement_id
        row["pending_strategy"] = "carry-forward-new-cycle"
        row["pending_cycle"] = cycle
        row["transition_history"].append({
            "strategy": "carry-forward-new-cycle",
            "dispatch_id": replacement_id,
            "cycle": cycle,
            "terminal_state": "pending",
        })
        return _issue_recovery_action(
            unit_id,
            replacement_id,
            "carry-forward-new-cycle",
            row["obligation_ids"],
            cycle,
            row["role_instance"],
            row["run_id"],
            row["fence"],
        )

    def finding_promotable(self, unit_id: str) -> bool:
        return bool(self._row(unit_id)["accepted"])

    def unresolved_units(self) -> tuple[str, ...]:
        return tuple(
            unit_id
            for unit_id, row in sorted(self._rows.items())
            if not row["accepted"]
        )

    def completed_cycle_evidenced(
        self,
        cycle: int,
        *,
        dispatch_ledger: DispatchLedger,
        captured_authority: Mapping[str, Any] | None = None,
    ) -> bool:
        """Prove every unresolved unit took a terminal action in this cycle."""

        if (
            type(cycle) is not int
            or cycle < self._start_cycle
            or cycle > self._limit_cycle
            or not isinstance(dispatch_ledger, DispatchLedger)
            or (
                captured_authority is not None
                and (
                    not captured_authority_valid(captured_authority)
                    or captured_authority["root_authority"]["cycle"] != cycle
                )
            )
        ):
            return False
        unresolved = self.unresolved_units()
        if not unresolved:
            return False
        for unit_id in unresolved:
            row = self._row(unit_id)
            history = row["transition_history"]
            if (
                row["pending_replacement_id"] is not None
                or not history
                or history[-1]["cycle"] != cycle
                or history[-1]["terminal_state"]
                not in {"timed-out", "cancelled", "incomplete"}
            ):
                return False
            try:
                dispatch = dispatch_ledger.snapshot(history[-1]["dispatch_id"])
            except RpfContractError:
                return False
            if (
                dispatch.get("state") != history[-1]["terminal_state"]
                or dispatch.get("expected", {}).get("cycle") != cycle
                or dispatch.get("expected", {}).get("role_instance")
                != row["role_instance"]
                or dispatch.get("expected", {}).get("run_id") != row["run_id"]
                or dispatch.get("expected", {}).get("fence") != row["fence"]
                or dispatch.get("expected_obligation_ids")
                != row["obligation_ids"]
            ):
                return False
        return True

    def completed_cycle_coverage(
        self, cycle: int, *, dispatch_ledger: DispatchLedger
    ) -> frozenset[str]:
        """Return role-qualified obligations proved terminal at the exact cycle."""

        if not self.completed_cycle_evidenced(
            cycle, dispatch_ledger=dispatch_ledger
        ):
            return frozenset()
        return frozenset(
            f"{row['role_instance']}::{obligation_id}"
            for unit_id in self.unresolved_units()
            for row in (self._row(unit_id),)
            for obligation_id in row["obligation_ids"]
        )

    def run_status(
        self,
        *,
        completed_cycle: int,
        goal_gaps: int,
        dispatch_ledger: DispatchLedger,
        user_authority_required: bool = False,
    ) -> str:
        if (
            type(completed_cycle) is not int
            or completed_cycle < 0
            or type(goal_gaps) is not int
            or goal_gaps < 0
            or type(user_authority_required) is not bool
            or not isinstance(dispatch_ledger, DispatchLedger)
        ):
            raise RpfContractError("continuation status input is malformed")
        if user_authority_required:
            return "waiting-user"
        if (
            goal_gaps == 0
            and not self.unresolved_units()
            and not dispatch_ledger.unresolved_restricted_obligations()
        ):
            return "recovery-clear"
        if (
            completed_cycle == self._limit_cycle
            and self.completed_cycle_evidenced(
                completed_cycle, dispatch_ledger=dispatch_ledger
            )
        ):
            return "limit-reached"
        return "running"

    def snapshot(self) -> bytes:
        payload = {
            "format": "rpf-adaptive-recovery-v1",
            "total_cycles": self._total_cycles,
            "start_cycle": self._start_cycle,
            "rows": {
                unit_id: {
                    "failure_kind": row["failure_kind"],
                    "failed_dispatch_id": row["failed_dispatch_id"],
                    "failure_cycle": row["failure_cycle"],
                    "role_instance": row["role_instance"],
                    "run_id": row["run_id"],
                    "fence": row["fence"],
                    "obligation_ids": list(row["obligation_ids"]),
                    "attempted": list(row["attempted"]),
                    "accepted": row["accepted"],
                    "last_carry_cycle": row["last_carry_cycle"],
                    "pending_replacement_id": row["pending_replacement_id"],
                    "pending_strategy": row["pending_strategy"],
                    "pending_cycle": row["pending_cycle"],
                    "accepted_result_sha256": row["accepted_result_sha256"],
                    "accepted_dispatch_id": row["accepted_dispatch_id"],
                    "accepted_cycle": row["accepted_cycle"],
                    "transition_history": row["transition_history"],
                }
                for unit_id, row in sorted(self._rows.items())
            },
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()

    def export_state(self, *, authentication_key: bytes) -> bytes:
        """Persist recovery state under a host-held restart authenticator."""

        payload = json.loads(
            self.snapshot().decode("utf-8"),
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
        return _encode_authenticated_state(
            payload, authentication_key=authentication_key
        )

    @classmethod
    def from_snapshot(
        cls,
        raw: bytes,
        *,
        authentication_key: bytes,
        accepted_results: Sequence[ValidatedChildResult] = (),
        dispatch_ledger: DispatchLedger | None = None,
        captured_authority: Mapping[str, Any] | None = None,
    ) -> "AdaptiveRecoveryLedger":
        try:
            value = _decode_authenticated_state(
                raw,
                authentication_key=authentication_key,
                expected_format="rpf-adaptive-recovery-v1",
            )
            if (
                not isinstance(value, dict)
                or set(value) != {"format", "total_cycles", "start_cycle", "rows"}
                or value.get("format") != "rpf-adaptive-recovery-v1"
                or type(value.get("total_cycles")) is not int
                or type(value.get("start_cycle")) is not int
                or not isinstance(value.get("rows"), dict)
            ):
                raise RpfContractError("recovery snapshot is malformed")
            ledger = cls(
                total_cycles=value["total_cycles"], start_cycle=value["start_cycle"]
            )
            accepted_dispatches: set[str] = set()
            accepted_results_seen: set[str] = set()
            for unit_id, saved in value["rows"].items():
                if not isinstance(saved, dict) or set(saved) != {
                    "failure_kind",
                    "failed_dispatch_id",
                    "failure_cycle",
                    "role_instance",
                    "run_id",
                    "fence",
                    "obligation_ids",
                    "attempted",
                    "accepted",
                    "last_carry_cycle",
                    "pending_replacement_id",
                    "pending_strategy",
                    "pending_cycle",
                    "accepted_result_sha256",
                    "accepted_dispatch_id",
                    "accepted_cycle",
                    "transition_history",
                }:
                    raise RpfContractError("recovery snapshot row is malformed")
                ledger.record_failure(
                    unit_id,
                    obligation_ids=saved["obligation_ids"],
                    failure_kind=saved["failure_kind"],
                    cycle=saved["failure_cycle"],
                    failed_dispatch_id=saved["failed_dispatch_id"],
                    dispatch_ledger=dispatch_ledger,
                    captured_authority=captured_authority,
                )
                row = ledger._row(unit_id)
                strategies = ledger._STRATEGIES[row["failure_kind"]]
                if not isinstance(dispatch_ledger, DispatchLedger):
                    raise RpfContractError(
                        "recovery snapshot lacks a live dispatch ledger"
                    )
                raw_history = saved["transition_history"]
                if (
                    isinstance(raw_history, list)
                    and raw_history
                    and isinstance(raw_history[-1], dict)
                    and raw_history[-1].get("terminal_state") == "pending"
                ):
                    try:
                        dispatch_ledger.snapshot(raw_history[-1].get("dispatch_id"))
                    except RpfContractError:
                        saved = copy.deepcopy(saved)
                        abandoned = saved["transition_history"].pop()
                        saved["pending_replacement_id"] = None
                        saved["pending_strategy"] = None
                        saved["pending_cycle"] = None
                        if abandoned.get("strategy") == "carry-forward-new-cycle":
                            prior_carries = [
                                item["cycle"]
                                for item in saved["transition_history"]
                                if item.get("strategy") == "carry-forward-new-cycle"
                            ]
                            saved["last_carry_cycle"] = (
                                prior_carries[-1] if prior_carries else None
                            )
                        elif saved.get("attempted"):
                            saved["attempted"].pop()
                attempted = saved["attempted"]
                history = saved["transition_history"]
                saved_fence = saved["fence"]
                normalized_saved_fence = (
                    saved_fence[0],
                    tuple(saved_fence[1]),
                    saved_fence[2],
                ) if (
                    isinstance(saved_fence, list)
                    and len(saved_fence) == 3
                    and isinstance(saved_fence[1], list)
                ) else saved_fence
                if (
                    saved["role_instance"] != row["role_instance"]
                    or saved["run_id"] != row["run_id"]
                    or normalized_saved_fence != row["fence"]
                    or not isinstance(attempted, list)
                    or tuple(attempted) != strategies[: len(attempted)]
                    or not isinstance(history, list)
                    or any(
                        not isinstance(item, dict)
                        or set(item)
                        != {"strategy", "dispatch_id", "cycle", "terminal_state"}
                        or not isinstance(item.get("strategy"), str)
                        or not isinstance(item.get("dispatch_id"), str)
                        or not item["dispatch_id"]
                        or type(item.get("cycle")) is not int
                        or item["cycle"] < saved["failure_cycle"]
                        or item["cycle"] > ledger._limit_cycle
                        or item.get("terminal_state")
                        not in {*DispatchLedger.TERMINAL, "pending"}
                        for item in history
                    )
                    or len({item["dispatch_id"] for item in history}) != len(history)
                    or [
                        item["strategy"]
                        for item in history
                        if item["strategy"] != "carry-forward-new-cycle"
                    ]
                    != attempted
                    or any(
                        item["strategy"] not in {*strategies, "carry-forward-new-cycle"}
                        for item in history
                    )
                    or any(
                        item["cycle"] != saved["failure_cycle"]
                        for item in history
                        if item["strategy"] != "carry-forward-new-cycle"
                    )
                    or [
                        item["cycle"]
                        for item in history
                        if item["strategy"] == "carry-forward-new-cycle"
                    ]
                    != list(
                        range(
                            saved["failure_cycle"] + 1,
                            saved["failure_cycle"]
                            + 1
                            + sum(
                                item["strategy"] == "carry-forward-new-cycle"
                                for item in history
                            ),
                        )
                    )
                    or any(
                        item["strategy"] == "carry-forward-new-cycle"
                        for item in history[: len(attempted)]
                    )
                    or (
                        any(
                            item["strategy"] == "carry-forward-new-cycle"
                            for item in history
                        )
                        and len(attempted) != len(strategies)
                    )
                    or saved["last_carry_cycle"]
                    != next(
                        (
                            item["cycle"]
                            for item in reversed(history)
                            if item["strategy"] == "carry-forward-new-cycle"
                        ),
                        None,
                    )
                    or type(saved["accepted"]) is not bool
                    or (
                        saved["pending_replacement_id"] is not None
                        and not isinstance(saved["pending_replacement_id"], str)
                    )
                    or (saved["pending_replacement_id"] is None)
                    != (saved["pending_strategy"] is None)
                    or (saved["pending_replacement_id"] is None)
                    != (saved["pending_cycle"] is None)
                    or (
                        saved["pending_cycle"] is not None
                        and (
                            type(saved["pending_cycle"]) is not int
                            or saved["pending_cycle"] < saved["failure_cycle"]
                            or saved["pending_cycle"] > ledger._limit_cycle
                        )
                    )
                    or sum(item["terminal_state"] == "pending" for item in history) > 1
                    or (
                        saved["pending_replacement_id"] is not None
                        and (
                            not history
                            or history[-1]["terminal_state"] != "pending"
                            or saved["pending_replacement_id"]
                            != history[-1]["dispatch_id"]
                            or saved["pending_strategy"] != history[-1]["strategy"]
                            or saved["pending_cycle"] != history[-1]["cycle"]
                        )
                    )
                    or (
                        saved["pending_replacement_id"] is None
                        and any(item["terminal_state"] == "pending" for item in history)
                    )
                    or (
                        saved["accepted_result_sha256"] is not None
                        and re.fullmatch(
                            r"[0-9a-f]{64}", saved["accepted_result_sha256"]
                        ) is None
                    )
                    or saved["accepted"]
                    != (saved["accepted_result_sha256"] is not None)
                    or (saved["accepted"] and saved["pending_replacement_id"] is not None)
                    or saved["accepted"]
                    != (saved["accepted_dispatch_id"] is not None)
                    or saved["accepted"] != (saved["accepted_cycle"] is not None)
                    or (
                        saved["accepted"]
                        and (
                            not history
                            or history[-1]["terminal_state"] != "completed"
                            or history[-1]["dispatch_id"]
                            != saved["accepted_dispatch_id"]
                            or history[-1]["cycle"] != saved["accepted_cycle"]
                        )
                    )
                    or (
                        not saved["accepted"]
                        and any(
                            item["terminal_state"] == "completed" for item in history
                        )
                    )
                ):
                    raise RpfContractError("recovery snapshot state is invalid")
                for item in history:
                    dispatch = dispatch_ledger.snapshot(item["dispatch_id"])
                    expected = dispatch.get("expected", {})
                    actual_state = dispatch.get("state")
                    if (
                        expected.get("role_instance") != row["role_instance"]
                        or expected.get("cycle") != item["cycle"]
                        or expected.get("run_id") != row["run_id"]
                        or expected.get("fence") != row["fence"]
                        or dispatch.get("expected_obligation_ids")
                        != row["obligation_ids"]
                        or dispatch.get("recovery_binding")
                        != {
                            "unit_id": unit_id,
                            "strategy": item["strategy"],
                            "cycle": item["cycle"],
                            "obligation_ids": row["obligation_ids"],
                            "role_instance": row["role_instance"],
                            "run_id": row["run_id"],
                            "fence": row["fence"],
                        }
                        or (
                            item["terminal_state"] == "pending"
                            and actual_state not in {
                                "active", "timed-out", "cancelled", "incomplete", "restricted"
                            }
                        )
                        or (
                            item["terminal_state"] != "pending"
                            and actual_state != item["terminal_state"]
                        )
                    ):
                        raise RpfContractError(
                            "recovery transition lacks exact dispatch evidence"
                        )
                if saved["accepted"]:
                    if (
                        saved["accepted_dispatch_id"] in accepted_dispatches
                        or saved["accepted_result_sha256"] in accepted_results_seen
                    ):
                        raise RpfContractError(
                            "accepted recovery evidence is reused by multiple units"
                        )
                    accepted_dispatches.add(saved["accepted_dispatch_id"])
                    accepted_results_seen.add(saved["accepted_result_sha256"])
                    matching = [
                        result
                        for result in accepted_results
                        if validated_child_result(result)
                        and result.envelope.get("dispatch_id")
                        == saved["accepted_dispatch_id"]
                        and result.envelope.get("cycle") == saved["accepted_cycle"]
                        and hashlib.sha256(result.raw).hexdigest()
                        == saved["accepted_result_sha256"]
                    ]
                    if (
                        len(matching) != 1
                        or not isinstance(dispatch_ledger, DispatchLedger)
                        or not isinstance(captured_authority, Mapping)
                        or not dispatch_ledger.publication_authorized(
                            saved["accepted_dispatch_id"], matching[0]
                        )
                        or not captured_authority_valid(captured_authority)
                        or matching[0].envelope.get("run_id")
                        != captured_authority["root_authority"]["run_id"]
                        or (
                            matching[0].envelope["fence"]["base"],
                            tuple(matching[0].envelope["fence"]["scope"]),
                            matching[0].envelope["fence"]["hash"],
                        )
                        != captured_authority["fence"]
                    ):
                        raise RpfContractError(
                            "accepted recovery snapshot lacks live sealed evidence"
                        )
                    coverage = matching[0].envelope.get("payload", {}).get(
                        "coverage", ()
                    )
                    if tuple(
                        item.get("obligation_id") for item in coverage
                    ) != tuple(saved["obligation_ids"]):
                        raise RpfContractError(
                            "accepted recovery snapshot coverage is not exact"
                        )
                    role = matching[0].envelope.get("role_instance")
                    authoritative = tuple(
                        obligation_id
                        for _, obligation_id in coverage_obligations_for_role(
                            captured_authority, role
                        )
                    )
                    if (
                        dispatch_ledger.snapshot(saved["accepted_dispatch_id"]).get(
                            "expected_obligation_ids"
                        )
                        != tuple(saved["obligation_ids"])
                        or tuple(
                            item
                            for item in authoritative
                            if item in set(saved["obligation_ids"])
                        )
                        != tuple(saved["obligation_ids"])
                    ):
                        raise RpfContractError(
                            "accepted recovery snapshot obligations are unauthorized"
                        )
                row.update(
                    saved,
                    fence=normalized_saved_fence,
                    obligation_ids=tuple(saved["obligation_ids"]),
                    transition_history=copy.deepcopy(history),
                )
            return ledger
        except (
            UnicodeDecodeError,
            json.JSONDecodeError,
            _DuplicateKey,
            RpfContractError,
            RecursionError,
            TypeError,
            ValueError,
        ) as error:
            if isinstance(error, RpfContractError):
                raise
            raise RpfContractError("recovery snapshot is malformed") from error

    def _row(self, unit_id: str) -> dict[str, Any]:
        try:
            return self._rows[unit_id]
        except KeyError as error:
            raise RpfContractError("unknown recovery unit") from error


def _restricted_transition(
    *, previous_restricted_attempts: int, sanitization_preserves_obligation: bool
) -> RestrictedTransition:
    if type(previous_restricted_attempts) is not int or previous_restricted_attempts < 0:
        raise RpfContractError("restricted attempt count is invalid")
    if type(sanitization_preserves_obligation) is not bool:
        raise RpfContractError("sanitization decision is invalid")
    if previous_restricted_attempts == 0 and sanitization_preserves_obligation:
        return RestrictedTransition("sanitized-retry", True, "continue")
    return RestrictedTransition("quarantined", False, "continue")


def artifact_namespace(
    pointer: Path,
    run_id: str,
    cycle: int,
    dispatch_id: str,
    persona_instance: str,
    *,
    repository_root: Path,
) -> Path:
    values = (run_id, dispatch_id, persona_instance)
    if type(cycle) is not int or cycle < 1 or any(
        not isinstance(value, str)
        or not re.fullmatch(r"[A-Za-z0-9._:-]+", value)
        or value in {".", ".."}
        for value in values
    ):
        raise RpfContractError("artifact identity is invalid")
    root, relative = _repository_relative(pointer, repository_root)
    pointer_id = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[:20]
    context_root = root / ".context"
    return (
        context_root
        / "reviews"
        / pointer_id
        / run_id
        / f"R{cycle}"
        / dispatch_id
        / persona_instance
    )


def publish_validated_artifact(
    pointer: Path,
    filename: str,
    result: ValidatedChildResult,
    *,
    authority: ExecutionAuthority,
    ledger: DispatchLedger,
    captured_authority: Mapping[str, Any],
) -> Path:
    require_mutation_authority(authority, "artifact")
    if (
        not validated_child_result(result)
        or result.envelope.get("kind") in {"restricted", "incomplete", "needs-scope-expansion"}
        or _document_restricted(result.raw)
    ):
        raise RpfContractError("only controller-validated child output may be published")
    if not captured_authority_valid(captured_authority):
        raise RpfContractError("artifact authority capture is invalid")
    pointer = _repository_pointer(
        pointer, Path(captured_authority["repository_root"]), exists=True
    )
    serialized_fence = result.envelope.get("fence")
    result_fence = (
        serialized_fence.get("base"),
        tuple(serialized_fence.get("scope", ())),
        serialized_fence.get("hash"),
    ) if isinstance(serialized_fence, Mapping) else None
    if (
        result_fence != captured_authority.get("fence")
        or result.envelope.get("cycle")
        != captured_authority["root_authority"]["cycle"]
        or result.envelope.get("run_id")
        != captured_authority["root_authority"]["run_id"]
        or result.envelope.get("role_instance")
        not in captured_authority.get("required_role_instances", ())
    ):
        raise RpfContractError("artifact result does not match captured authority")
    try:
        pointer_bytes, _ = _read_stable(pointer)
    except (OSError, RpfContractError, RpfConflictError) as error:
        raise RpfContractError("artifact pointer no longer matches its capture") from error
    if (
        pointer_bytes != captured_authority.get("pointer_bytes")
        or hashlib.sha256(pointer_bytes).hexdigest() != captured_authority["root_hash"]
    ):
        raise RpfContractError("artifact pointer bytes differ from captured authority")
    if not isinstance(filename, str) or re.fullmatch(r"[A-Za-z0-9._-]+\.json", filename) is None:
        raise RpfContractError("artifact filename is invalid")
    dispatch_id = result.envelope["dispatch_id"]
    if not ledger.publication_authorized(dispatch_id, result):
        raise RpfContractError("artifact result is not accepted by its dispatch ledger")
    expected_coverage = tuple(
        obligation_id
        for _, obligation_id in coverage_obligations_for_role(
            captured_authority, result.envelope["role_instance"]
        )
    )
    returned_coverage = tuple(
        item.get("obligation_id")
        for item in result.envelope.get("payload", {}).get("coverage", ())
    )
    if returned_coverage != expected_coverage:
        raise RpfContractError("artifact result lacks exact authoritative coverage")
    namespace = artifact_namespace(
        pointer,
        result.envelope["run_id"],
        result.envelope["cycle"],
        dispatch_id,
        result.envelope["role_instance"],
        repository_root=Path(captured_authority["repository_root"]),
    )
    root, relative = _repository_relative(
        namespace, Path(captured_authority["repository_root"])
    )
    directory_fd, namespace = _open_repository_directory(
        root, relative.parts, create=True
    )
    target = namespace / filename
    try:
        if not _directory_matches_fd(namespace, directory_fd):
            raise RpfConflictError("artifact namespace identity changed before write")
        _write_private_at(directory_fd, filename, result.raw)
        os.fsync(directory_fd)
        if (
            not _directory_matches_fd(namespace, directory_fd)
            or not target.is_file()
            or _read_at(directory_fd, filename, max_bytes=max(len(result.raw), 1))
            != result.raw
        ):
            try:
                os.unlink(filename, dir_fd=directory_fd)
            except OSError:
                pass
            raise RpfConflictError("artifact namespace identity changed during write")
    finally:
        os.close(directory_fd)
    return target


def authority_digest(value: Mapping[str, Any]) -> str:
    def thaw(item: object) -> object:
        if isinstance(item, Mapping):
            return {str(key): thaw(nested) for key, nested in item.items()}
        if isinstance(item, (list, tuple)):
            return [thaw(nested) for nested in item]
        return item

    try:
        payload = json.dumps(
            thaw(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise RpfContractError("authority is not canonical JSON") from error
    return hashlib.sha256(payload).hexdigest()


_ROOT_AUTHORITY_FIELDS = {
    "pointer_revision",
    "projection_sha256",
    "cycle",
    "run_id",
    "fence",
    "contracts",
    "gate_results",
    "aggregate_claims",
    "selected_personas",
    "persona_evidence",
    "repository_roles",
    "topology",
    "regression_watches",
    "ui_mapping",
    "no_ui_detection",
    "ui_runtime_results",
    "runtime_records",
    "runtime_receipts",
    "backup_records",
    "backup_comparisons",
    "incident_coverage",
    "recovery_state",
    "convergence_state",
    "open_gap_ids",
    "test_prohibitions",
    "residual_risks",
    "risk_acceptance",
    "completion_criteria",
}

_AUTHORITY_BLOCK = re.compile(
    rb"<!-- rpf:authority-json\n(?P<json>\{.*?\})\n-->", re.DOTALL
)


def serialize_root_authority(root_authority: Mapping[str, Any]) -> bytes:
    if not isinstance(root_authority, Mapping):
        raise RpfContractError("root authority must be an object")
    payload = json.dumps(
        root_authority,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return b"<!-- rpf:authority-json\n" + payload + b"\n-->"


def parse_root_authority(pointer_bytes: bytes) -> Mapping[str, Any]:
    if not isinstance(pointer_bytes, bytes):
        raise RpfContractError("pointer bytes are required")
    matches = list(_AUTHORITY_BLOCK.finditer(pointer_bytes))
    if len(matches) != 1:
        raise RpfContractError("pointer must contain exactly one authority block")
    try:
        root = json.loads(
            matches[0].group("json"),
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _DuplicateKey,
        RpfContractError,
        RecursionError,
        TypeError,
        ValueError,
    ) as error:
        raise RpfContractError("pointer authority JSON is malformed") from error
    if not isinstance(root, dict):
        raise RpfContractError("pointer authority is not an object")
    if _document_restricted(matches[0].group("json")):
        raise RpfContractError("pointer authority contains restricted decoded content")

    def normalize_fence(value: object) -> object:
        if isinstance(value, list) and len(value) == 3 and isinstance(value[1], list):
            return value[0], tuple(value[1]), value[2]
        return value

    root["fence"] = normalize_fence(root.get("fence"))
    for table in ("gate_results", "regression_watches", "test_prohibitions"):
        if isinstance(root.get(table), list):
            for row in root[table]:
                if isinstance(row, dict):
                    row["fence"] = normalize_fence(row.get("fence"))
    if isinstance(root.get("ui_runtime_results"), list):
        for row in root["ui_runtime_results"]:
            if isinstance(row, dict):
                row["fence"] = normalize_fence(row.get("fence"))
    if isinstance(root.get("no_ui_detection"), dict):
        root["no_ui_detection"]["fence"] = normalize_fence(
            root["no_ui_detection"].get("fence")
        )
    for table in ("runtime_records", "backup_records", "backup_comparisons"):
        if isinstance(root.get(table), dict):
            for row in root[table].values():
                if isinstance(row, dict):
                    row["fence"] = normalize_fence(row.get("fence"))
    return root


def pointer_projection_digest(pointer_bytes: bytes) -> str:
    """Hash every non-authority byte so visible projections cannot drift silently."""

    matches = list(_AUTHORITY_BLOCK.finditer(pointer_bytes))
    if len(matches) != 1:
        raise RpfContractError("pointer must contain exactly one authority block")
    match = matches[0]
    projection = pointer_bytes[: match.start()] + pointer_bytes[match.end() :]
    return hashlib.sha256(projection).hexdigest()


_GAME_MARKERS: Mapping[str, tuple[bytes, ...]] = {
    "lifecycle": (b"project.godot", b"application/run", b"initialize", b"shutdown"),
    "scenes": (b"main_scene", b".tscn", b"scene", b"prefab"),
    "assets": (b"res://", b"asset", b"resource"),
    "input": (b"input", b"action", b"keycode"),
    "state": (b"state", b"store", b"reducer"),
    "physics/AI": (b"physics", b"rigidbody", b"navigation", b"behavior"),
    "combat": (b"combat", b"damage", b"health", b"weapon"),
    "economy/progression": (b"currency", b"economy", b"progress", b"inventory"),
    "save/load": (b"save", b"load", b"serialize", b"persist"),
    "network": (b"network", b"rpc", b"replic", b"socket"),
    "UI": (b"<button", b"button", b"render_", b"viewport", b"accessibility"),
    "platform variants": (b"platform", b"android", b"ios", b"windows", b"linux"),
}


def _first_source_ref(
    source_bytes: Mapping[str, bytes], markers: Sequence[bytes]
) -> Mapping[str, Any]:
    for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
        try:
            lines = source_bytes[path].decode("utf-8", errors="strict").splitlines() or [""]
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            lowered = line.lower().encode("utf-8")
            if any(marker.lower() in lowered for marker in markers):
                symbol_match = re.search(r"[A-Za-z_][A-Za-z0-9_./:-]*", line)
                symbol = symbol_match.group(0) if symbol_match else line[:1] or "_"
                return {"path": path, "line": number, "symbol": symbol}
    for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
        try:
            lines = source_bytes[path].decode("utf-8", errors="strict").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            symbol_match = re.search(r"[A-Za-z_][A-Za-z0-9_./:-]*", line)
            if symbol_match:
                return {
                    "path": path,
                    "line": number,
                    "symbol": symbol_match.group(0),
                }
            if line:
                return {"path": path, "line": number, "symbol": line[0]}
    raise RpfContractError("approved source has no citable text")


def _game_project_detected(source_bytes: Mapping[str, bytes]) -> bool:
    strong_names = {
        "project.godot",
        "game.project",
        "game.config",
    }
    strong_suffixes = (
        ".tscn",
        ".gd",
        ".unity",
        ".prefab",
        ".uproject",
        ".umap",
        ".shader",
    )
    return any(
        Path(path).name.lower() in strong_names
        or path.lower().endswith(strong_suffixes)
        for path in source_bytes
    )


def derive_game_topology(source_bytes: Mapping[str, bytes]) -> Mapping[str, Mapping[str, Any]]:
    if not source_bytes:
        raise RpfContractError("topology derivation requires approved source")
    combined = b"\n".join(
        path.encode("utf-8") + b"\n" + source_bytes[path].lower()
        for path in sorted(source_bytes)
    )
    game_project = _game_project_detected(source_bytes)
    known_paths = set(source_bytes)
    basename_to_paths: dict[str, set[str]] = {}
    for path in known_paths:
        basename_to_paths.setdefault(Path(path).name, set()).add(path)

    def references_from(path: str) -> tuple[set[str], set[str]]:
        data = source_bytes[path]
        try:
            text = data.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            # Opaque model/archive formats can contain embedded path strings.
            # Extract only bounded ASCII path tokens and keep one explicit
            # uninspectable sentinel when bytes cannot be decoded as text.
            ascii_tokens = re.findall(
                rb"(?:res://)?[A-Za-z0-9_./:-]{1,512}\.(?:"
                rb"tscn|scn|gd|unity|prefab|umap|uasset|png|jpg|jpeg|webp|svg|"
                rb"json|cfg|tres|shader|material|wav|ogg|mp3|webm|mp4|anim|"
                rb"mesh|glb|gltf|ttf|otf)",
                data,
                flags=re.IGNORECASE,
            )
            text = "\n".join(
                token.decode("ascii", errors="strict") for token in ascii_tokens
            )
            if not ascii_tokens:
                return (
                    set(),
                    {f"uninspectable-binary:{path}"} if game_project else set(),
                )
        edges: set[str] = set()
        frontier: set[str] = set()
        candidates = set(
            re.findall(
                r"(?:res://)?[A-Za-z0-9_./:-]+\."
                r"(?:tscn|scn|gd|unity|prefab|umap|uasset|png|jpg|jpeg|webp|svg|json|cfg|tres|shader|material|wav|ogg|mp3|webm|mp4|anim|mesh|glb|gltf|ttf|otf)",
                text,
                flags=re.IGNORECASE,
            )
        )
        for candidate in candidates:
            normalized = candidate.removeprefix("res://").lstrip("./")
            local = (Path(path).parent / normalized).as_posix()
            if normalized in known_paths:
                edges.add(normalized)
                continue
            if local in known_paths:
                edges.add(local)
                continue
            basename_matches = basename_to_paths.get(Path(normalized).name, set())
            if len(basename_matches) == 1:
                edges.update(basename_matches)
            else:
                frontier.add(normalized)
        return edges, frontier

    all_edges: set[tuple[str, str]] = set()
    all_frontier: set[str] = set()
    if game_project:
        for inventory_path in sorted(
            known_paths, key=lambda value: value.encode("utf-8")
        ):
            targets, unresolved = references_from(inventory_path)
            all_edges.update(
                (inventory_path, target)
                for target in targets
                if target != inventory_path
            )
            all_frontier.update(unresolved)

    topology: dict[str, Mapping[str, Any]] = {}
    for family, markers in _GAME_MARKERS.items():
        applicable = game_project and any(
            marker.lower() in combined for marker in markers
        )
        ref = _first_source_ref(source_bytes, markers if applicable else ())
        roots = sorted(
            path for path, data in source_bytes.items()
            if any(
                marker.lower() in path.lower().encode() + b"\n" + data.lower()
                for marker in markers
            )
        ) if applicable else []
        family_edges = {
            (source, target)
            for source, target in all_edges
            if any(
                marker.lower()
                in (
                    source.lower().encode("utf-8")
                    + b"\n"
                    + source_bytes[source].lower()
                )
                for marker in markers
            )
            or source in roots
        }
        topology[family] = {
            "applicable": applicable,
            "reason": (
                "approved-game-source-marker"
                if applicable
                else (
                    "approved-game-inventory-no-family-marker"
                    if game_project
                    else "approved-inventory-not-game-project"
                )
            ),
            "roots": roots,
            "node_count": len(known_paths),
            "edge_count": len(family_edges),
            "budget": len(known_paths) + len(family_edges),
            "frontier": sorted(all_frontier, key=lambda value: value.encode("utf-8")),
            "refs": [ref],
        }
    return topology


# `router` and `navigate` are ordinary English words. As bare substrings they
# matched a Markdown table documenting a CLI subcommand named `navigate`, and a
# `router_commands()` helper that registers CLI verbs -- neither of which is a
# rendered surface, and each of which then claimed six unverifiable UI
# obligations. Require the shapes these words take when they really do drive a
# view: a call, a member access, a hook, a factory, or a router element.
_UI_USAGE_MARKERS = re.compile(
    rb"\brouter\s*[.(\[]"
    rb"|\buse_?router\b"
    rb"|\bcreate_?router\b"
    rb"|<router\b"
    rb"|\brouter-?(?:link|view|outlet|module)\b"
    rb"|\bnavigate\s*[(:]"
    rb"|\.navigate\b"
    rb"|\buse_?navigate\b"
    rb"|\bnavigate_?to\b"
)


def derive_ui_mapping(source_bytes: Mapping[str, bytes]) -> Mapping[str, str]:
    # Unambiguous markup, DOM and CSS markers: any file carrying one of these
    # is a UI surface whatever its suffix, so an HTML fragment embedded in a
    # document is still detected.
    ui_markers = (
        b"<div",
        b"<button",
        b"onclick",
        b"onkeydown",
        b"aria-",
        b"overflow",
        b"classname",
        b"sharescreen",
        b"viewport",
        b"@media",
        b"render_",
    )
    surface_pattern = re.compile(
        rb"(?:<[a-z][^>]*|function\s+[A-Za-z0-9_]*(?:screen|page|view|dialog)|"
        rb"class\s+[A-Za-z0-9_]*(?:screen|page|view|dialog)|render[_a-z0-9]*\s*\()",
        re.IGNORECASE,
    )
    mapping: dict[str, str] = {}
    for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
        lowered = source_bytes[path].lower()
        if not any(marker in lowered for marker in ui_markers) and not (
            _UI_USAGE_MARKERS.search(lowered)
        ):
            continue
        surfaces = [
            (line_number, match.start(), match.group(0))
            for line_number, line in enumerate(lowered.splitlines(), 1)
            for match in surface_pattern.finditer(line)
        ]
        if not surfaces:
            surfaces = [(1, 0, b"detected-ui-file")]
        for line_number, byte_offset, marker in surfaces:
            surface = hashlib.sha256(
                path.encode("utf-8")
                + b"\0"
                + str(line_number).encode("ascii")
                + b"\0"
                + str(byte_offset).encode("ascii")
                + b"\0"
                + marker
            ).hexdigest()[:12]
            for kind in UI_KINDS:
                mapping[f"UI-{surface}-{kind}"] = kind
    return mapping


_INCIDENT_MARKERS: Mapping[str, tuple[tuple[bytes, ...], ...]] = {
    "state-file-corruption-overwrite": (
        (b"state",), (b"write", b"persist"), (b"json", b"decode", b"corrupt"),
    ),
    "email-only-auth-default": (
        (b"email",), (b"auth", b"login"), (b"default", b"provider", b"fallback"),
    ),
    "session-teardown-concurrency-loss": (
        (b"session",), (b"logout", b"teardown", b"revoke"),
        (b"concurr", b"lock", b"transaction", b"atomic"),
    ),
    "chat-final-save-truthfulness": (
        (b"chat", b"message"), (b"final", b"complete"),
        (b"save", b"persist"), (b"error", b"fail", b"exception"),
    ),
    "backup-restore-equivalence": (
        (b"backup", b"export"), (b"restore", b"import"),
        (b"schema", b"content", b"ordering", b"version"),
    ),
    "mobile-clipping-accessibility": (
        (b"mobile", b"viewport", b"@media"), (b"overflow", b"clip"),
        (b"aria-", b"accessibility"),
    ),
}

_INCIDENT_CODE_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cs", ".go", ".gd", ".java", ".js", ".jsx",
    ".kt", ".kts", ".lua", ".php", ".py", ".rb", ".rs", ".swift",
    ".ts", ".tsx", ".vue", ".svelte", ".sh", ".sql",
}


def _incident_group_ref(
    source_bytes: Mapping[str, bytes], markers: Sequence[bytes]
) -> Mapping[str, Any] | None:
    """Return a marker-specific code reference, never a prose keyword hit."""

    for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
        if Path(path).suffix.lower() not in _INCIDENT_CODE_SUFFIXES:
            continue
        lines = source_bytes[path].decode("utf-8", errors="strict").splitlines()
        for number, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith(("#", "//", "/*", "*", "<!--")):
                continue
            if re.match(
                r"(?i)\s*(?:def|function|fn|class|interface|type|import|from|using)\b",
                line,
            ):
                continue
            if re.match(
                r"\s*[A-Z][A-Z0-9_]*(?:\s*:\s*[^=]+)?\s*=",
                line,
            ):
                continue
            without_literals = re.sub(
                r"(?s)(?:[rubfRUBF]{0,2})(?:'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`)",
                "",
                line,
            )
            if re.fullmatch(
                r"\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*:\s*[^=]+)?\s*=\s*",
                without_literals,
            ):
                continue
            lowered = without_literals.lower().encode("utf-8")
            for marker in markers:
                marker_lower = marker.lower()
                if marker_lower not in lowered:
                    continue
                if (
                    "=" in without_literals
                    and not re.search(r"(?:==|!=|<=|>=|=>)", without_literals)
                ):
                    left, right = without_literals.split("=", 1)
                    if (
                        marker.decode("ascii").lower() in left.lower()
                        and marker.decode("ascii").lower() not in right.lower()
                    ):
                        continue
                if marker_lower in lowered:
                    return {
                        "path": path,
                        "line": number,
                        "symbol": marker.decode("ascii"),
                    }
    return None


def derive_incident_coverage(
    source_bytes: Mapping[str, bytes],
) -> Mapping[str, Mapping[str, Any]]:
    if not source_bytes:
        raise RpfContractError("incident derivation requires approved source")
    result: dict[str, Mapping[str, Any]] = {}
    for family, marker_groups in _INCIDENT_MARKERS.items():
        grouped_refs = [_incident_group_ref(source_bytes, group) for group in marker_groups]
        applicable = all(ref is not None for ref in grouped_refs)
        refs = (
            [ref for ref in grouped_refs if ref is not None]
            if applicable
            else [_first_source_ref(source_bytes, ())]
        )
        if applicable and len({
            (ref["path"], ref["line"], ref["symbol"]) for ref in refs
        }) != len(marker_groups):
            applicable = False
            refs = [_first_source_ref(source_bytes, ())]
        result[family] = {
            "applicable": applicable,
            "refs": refs,
            "obligation_id": f"incident:{family}",
        }
    return result


_GAME_INVENTORY_SUFFIXES = {
    ".tscn", ".scn", ".gd", ".unity", ".prefab", ".uproject", ".umap",
    ".uasset", ".shader", ".material", ".tres", ".anim", ".mesh", ".wav",
    ".ogg", ".mp3", ".webm", ".mp4", ".glb", ".gltf", ".png", ".jpg",
    ".jpeg", ".webp", ".svg", ".ttf", ".otf", ".json", ".cfg",
    ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java",
    ".js", ".jsx", ".kt", ".lua", ".m", ".mm", ".py", ".rs",
    ".swift", ".ts", ".tsx",
}


def required_game_inventory_paths(
    source_bytes: Mapping[str, bytes], repository_root: Path
) -> tuple[str, ...]:
    """Derive metadata-complete game scope from manifests in the approved scope."""

    root = repository_root.resolve(strict=True)
    manifests: list[str] = [
        path
        for path in source_bytes
        if Path(path).name.lower() in {"project.godot", "game.project", "game.config"}
        or Path(path).suffix.lower() == ".uproject"
    ]
    for current, directories, filenames in os.walk(root, followlinks=False):
        directories[:] = sorted(
            name
            for name in directories
            if name
            not in {
                ".git",
                ".context",
                "node_modules",
                "vendor",
                "tests",
                "test",
                "fixtures",
            }
            and not (Path(current) / name).is_symlink()
        )
        for filename in sorted(filenames):
            candidate = Path(current) / filename
            if (
                filename.lower() in {"project.godot", "game.project", "game.config"}
                or candidate.suffix.lower() == ".uproject"
            ):
                relative = candidate.relative_to(root).as_posix()
                if relative not in manifests:
                    manifests.append(relative)
    required: set[str] = set()
    for manifest in manifests:
        project_dir = root / Path(manifest).parent
        for current, directories, filenames in os.walk(project_dir, followlinks=False):
            directories[:] = sorted(
                directory
                for directory in directories
                if directory not in {".git", ".context"}
                and not (Path(current) / directory).is_symlink()
            )
            for filename in sorted(filenames):
                path = Path(current) / filename
                try:
                    info = path.lstat()
                except OSError as error:
                    raise RpfContractError("game inventory metadata is unreadable") from error
                if (
                    stat.S_ISREG(info.st_mode)
                    and (
                        path.name.lower() in {"project.godot", "game.project", "game.config"}
                        or path.suffix.lower() in _GAME_INVENTORY_SUFFIXES
                    )
                ):
                    required.add(path.relative_to(root).as_posix())
    return tuple(sorted(required, key=lambda value: value.encode("utf-8")))

_TOPOLOGY_AUTHORITY_FIELDS = {
    "applicable",
    "reason",
    "roots",
    "node_count",
    "edge_count",
    "budget",
    "frontier",
    "refs",
}


_SOURCE_CONTRACT_DECLARATION = re.compile(
    r'^\s*RPF_SOURCE_CONTRACT\s*=\s*["\'](?P<id>[A-Za-z0-9_.:-]+)\|(?P<name>[^|"\']+)["\']\s*$'
)
_CONFIGURED_GATE_DECLARATION = re.compile(
    r'^\s*RPF_CONFIGURED_GATE\s*=\s*["\'](?P<id>[A-Za-z0-9_.:-]+)\|(?P<command>[^|"\']+)\|(?P<contracts>[A-Za-z0-9_.:, -]+)["\']\s*$'
)
_TEST_PROHIBITION_DECLARATION = re.compile(
    r'^\s*RPF_TEST_PROHIBITION\s*=\s*["\'](?P<id>[A-Za-z0-9_.:-]+)\|(?P<command>[^|"\']+)\|(?P<contracts>[A-Za-z0-9_.:, -]+)["\']\s*$'
)


def derive_source_contract_inventory(
    source_bytes: Mapping[str, bytes],
    *,
    base: str,
    repository_root: Path,
) -> Mapping[str, Any]:
    """Derive contracts, configured gates, and prohibitions from typed source."""

    contracts: dict[str, dict[str, Any]] = {}
    gates: dict[str, dict[str, Any]] = {}
    prohibitions: dict[str, dict[str, Any]] = {}
    for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
        try:
            lines = source_bytes[path].decode("utf-8", errors="strict").splitlines()
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(lines, 1):
            contract_match = _SOURCE_CONTRACT_DECLARATION.fullmatch(line)
            gate_match = _CONFIGURED_GATE_DECLARATION.fullmatch(line)
            prohibition_match = _TEST_PROHIBITION_DECLARATION.fullmatch(line)
            if contract_match:
                contract_id = contract_match["id"]
                if contract_id in contracts:
                    raise RpfConflictError("source-contract declaration is duplicated")
                contracts[contract_id] = {
                    "name": contract_match["name"].strip(),
                    "changed": True,
                    "still_current": True,
                }
            elif gate_match or prohibition_match:
                match = gate_match or prohibition_match
                assert match is not None
                contract_ids = tuple(
                    item.strip() for item in match["contracts"].split(",") if item.strip()
                )
                target = gates if gate_match else prohibitions
                if match["id"] in target or not contract_ids:
                    raise RpfConflictError("gate/prohibition declaration is duplicated")
                target[match["id"]] = {
                    "id": match["id"],
                    "command": match["command"].strip(),
                    "affected_contract_ids": list(contract_ids),
                    "path": path,
                    "line": line_number,
                    "symbol": (
                        "RPF_CONFIGURED_GATE"
                        if gate_match
                        else "RPF_TEST_PROHIBITION"
                    ),
                }
    declared_ids = set(contracts)
    if any(
        set(item["affected_contract_ids"]) - declared_ids
        for item in (*gates.values(), *prohibitions.values())
    ):
        raise RpfContractError("gate/prohibition references an undeclared contract")
    if base != "PRE-CONTRACT":
        root = repository_root.resolve(strict=True)
        scope_changed = False
        for path in sorted(source_bytes, key=lambda value: value.encode("utf-8")):
            try:
                previous = subprocess.run(
                    ["git", "show", f"{base}:{path}"],
                    cwd=root,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=10,
                )
            except (OSError, subprocess.SubprocessError) as error:
                raise RpfContractError(
                    "source-contract base could not be inspected"
                ) from error
            scope_changed = scope_changed or (
                previous.returncode != 0 or previous.stdout != source_bytes[path]
            )
        for contract in contracts.values():
            contract["changed"] = scope_changed
    return {
        "contracts": contracts,
        "gates": gates,
        "prohibitions": prohibitions,
    }


def _topology_authority_shape_valid(value: object) -> bool:
    if not isinstance(value, Mapping) or set(value) != _TOPOLOGY_AUTHORITY_FIELDS:
        return False
    applicable = value.get("applicable")
    roots = value.get("roots")
    node_count = value.get("node_count")
    edge_count = value.get("edge_count")
    budget = value.get("budget")
    frontier = value.get("frontier")
    refs = value.get("refs")
    if (
        type(applicable) is not bool
        or not isinstance(value.get("reason"), str)
        or not value["reason"]
        or not isinstance(roots, list)
        or any(not isinstance(root, str) or not root for root in roots)
        or len(roots) != len(set(roots))
        or type(node_count) is not int
        or node_count < 1
        or type(edge_count) is not int
        or edge_count < 0
        or type(budget) is not int
        or budget < node_count + edge_count
        or not isinstance(frontier, list)
        or any(not isinstance(item, str) or not item for item in frontier)
        or not isinstance(refs, list)
        or not refs
        or any(
            not isinstance(ref, Mapping)
            or set(ref) != {"path", "line", "symbol"}
            or not isinstance(ref.get("path"), str)
            or not ref["path"]
            or type(ref.get("line")) is not int
            or ref["line"] < 1
            or not isinstance(ref.get("symbol"), str)
            or not ref["symbol"]
            for ref in refs
        )
    ):
        return False
    return bool((applicable and roots) or (not applicable and not roots))


def capture_authority(
    pointer_bytes: bytes,
    approved_fence: tuple[str, tuple[str, ...], str],
    source_bytes: Mapping[str, bytes],
    repository_root: Path,
    *,
    validated_results: Sequence[ValidatedChildResult] = (),
    user_authorizations: Sequence[UserAuthorization] = (),
    runtime_receipts: Sequence[RuntimeReceipt] = (),
    recovery_snapshot: bytes = b"",
    dispatch_ledger: DispatchLedger | None = None,
) -> Mapping[str, Any]:
    """Validate and seal only authority reconstructed from the root pointer."""

    if (
        not isinstance(pointer_bytes, bytes)
        or _document_restricted(pointer_bytes)
        or not isinstance(validated_results, Sequence)
        or isinstance(validated_results, (str, bytes, bytearray))
        or any(not validated_child_result(result) for result in validated_results)
        or not isinstance(user_authorizations, Sequence)
        or isinstance(user_authorizations, (str, bytes, bytearray))
        or not isinstance(runtime_receipts, Sequence)
        or isinstance(runtime_receipts, (str, bytes, bytearray))
        or any(not _runtime_receipt_valid(receipt) for receipt in runtime_receipts)
        or not isinstance(recovery_snapshot, bytes)
    ):
        raise RpfContractError("external authority inputs are malformed")
    root_authority = parse_root_authority(pointer_bytes)

    if (
        not isinstance(root_authority, Mapping)
        or set(root_authority) != _ROOT_AUTHORITY_FIELDS
        or canonical_fence(
            approved_fence[0],
            approved_fence[1],
            approved_fence[2],
            source_bytes,
            repository_root=repository_root,
        ) != approved_fence
        or root_authority.get("fence") != approved_fence
        or type(root_authority.get("pointer_revision")) is not int
        or root_authority["pointer_revision"] < 0
        or root_authority.get("projection_sha256")
        != pointer_projection_digest(pointer_bytes)
        or type(root_authority.get("cycle")) is not int
        or root_authority["cycle"] < 1
        or not isinstance(root_authority.get("run_id"), str)
        or not root_authority["run_id"]
    ):
        raise RpfContractError("root authority identity is incomplete")

    contracts = root_authority.get("contracts")
    gates = root_authority.get("gate_results")
    claims = root_authority.get("aggregate_claims")
    personas = root_authority.get("selected_personas")
    persona_evidence = root_authority.get("persona_evidence")
    repository_roles = root_authority.get("repository_roles")
    topology = root_authority.get("topology")
    watches = root_authority.get("regression_watches")
    ui_mapping = root_authority.get("ui_mapping")
    no_ui_detection = root_authority.get("no_ui_detection")
    ui_runtime_results = root_authority.get("ui_runtime_results")
    runtime_records = root_authority.get("runtime_records")
    persisted_receipts = root_authority.get("runtime_receipts")
    backup_records = root_authority.get("backup_records")
    backup_comparisons = root_authority.get("backup_comparisons")
    incident_coverage = root_authority.get("incident_coverage")
    recovery_state = root_authority.get("recovery_state")
    convergence_state = root_authority.get("convergence_state")
    open_gap_ids = root_authority.get("open_gap_ids")
    test_prohibitions = root_authority.get("test_prohibitions")
    residual_risks = root_authority.get("residual_risks")
    risk_acceptance = root_authority.get("risk_acceptance")
    completion_criteria = root_authority.get("completion_criteria")
    if (
        not isinstance(contracts, Mapping)
        or any(
            not isinstance(contract_id, str)
            or not contract_id
            or not isinstance(contract, Mapping)
            or set(contract) != {"name", "changed", "still_current"}
            or not isinstance(contract.get("name"), str)
            or not contract["name"]
            or type(contract.get("changed")) is not bool
            or type(contract.get("still_current")) is not bool
            for contract_id, contract in contracts.items()
        )
        or not isinstance(gates, list)
        or not gates
        or any(
            not isinstance(gate, Mapping)
            or set(gate) != {"id", "classification", "affected_contract_ids", "fence"}
            or not isinstance(gate.get("id"), str)
            or not gate["id"]
            or not isinstance(gate.get("classification"), str)
            or gate.get("classification")
            not in {
                "passed",
                "failed",
                "not-run-prohibited",
                "not-run-unavailable",
                "not-applicable",
            }
            or not isinstance(gate.get("affected_contract_ids"), list)
            or any(
                not isinstance(contract_id, str) or not contract_id
                for contract_id in gate["affected_contract_ids"]
            )
            or any(item not in contracts for item in gate["affected_contract_ids"])
            or gate.get("fence") != approved_fence
            for gate in gates
        )
        or not isinstance(personas, list)
        or not 1 <= len(personas) <= 6
        or not _all_strings(personas)
        or len(personas) != len(set(personas))
        or any(persona not in BUNDLED_PERSONAS for persona in personas)
        or not isinstance(persona_evidence, Mapping)
        or set(persona_evidence) != set(personas)
        or any(
            not isinstance(row, Mapping)
            or set(row) != {"source", "applicable", "reason", "refs"}
            or row.get("source") != "bundled"
            or row.get("applicable") is not True
            or not isinstance(row.get("reason"), str)
            or not row["reason"]
            or not isinstance(row.get("refs"), list)
            or not row["refs"]
            for row in persona_evidence.values()
        )
        or not isinstance(repository_roles, list)
        or any(not isinstance(role, str) or not role for role in repository_roles)
        or len(repository_roles) != len(set(repository_roles))
        or not isinstance(claims, Mapping)
        or not claims
        or not isinstance(topology, Mapping)
        or set(topology) != set(GAME_FAMILIES)
        or any(
            not _topology_authority_shape_valid(authority)
            for authority in topology.values()
        )
        or not isinstance(watches, list)
        or not isinstance(ui_mapping, Mapping)
        or any(
            not isinstance(ui_id, str)
            or not ui_id
            or not isinstance(kind, str)
            or kind not in UI_KINDS
            for ui_id, kind in ui_mapping.items()
        )
        or not isinstance(runtime_records, Mapping)
        or not isinstance(persisted_receipts, Mapping)
        or not isinstance(ui_runtime_results, list)
        or not isinstance(backup_records, Mapping)
        or not isinstance(backup_comparisons, Mapping)
        or not isinstance(incident_coverage, Mapping)
        or set(incident_coverage) != set(INCIDENT_FAMILIES)
        or not isinstance(recovery_state, Mapping)
        or set(recovery_state)
        != {
            "format",
            "total_cycles",
            "start_cycle",
            "snapshot_sha256",
            "unresolved_units",
        }
        or recovery_state.get("format") != "rpf-adaptive-recovery-v1"
        or type(recovery_state.get("total_cycles")) is not int
        or recovery_state["total_cycles"] < 1
        or type(recovery_state.get("start_cycle")) is not int
        or recovery_state["start_cycle"] < 1
        or not isinstance(recovery_state.get("snapshot_sha256"), str)
        or re.fullmatch(r"[0-9a-f]{64}", recovery_state["snapshot_sha256"]) is None
        or not isinstance(recovery_state.get("unresolved_units"), list)
        or any(
            not isinstance(item, str) or not item
            for item in recovery_state["unresolved_units"]
        )
        or not isinstance(convergence_state, Mapping)
        or set(convergence_state)
        != {
            "open_work_ids",
            "open_feedback_ids",
            "open_reconciliation_ids",
            "open_secret_incident_ids",
        }
        or any(
            not isinstance(convergence_state.get(field), list)
            or any(
                not isinstance(item, str) or not item
                for item in convergence_state[field]
            )
            or len(convergence_state[field]) != len(set(convergence_state[field]))
            or convergence_state[field]
            != sorted(
                convergence_state[field], key=lambda value: value.encode("utf-8")
            )
            for field in (
                "open_work_ids",
                "open_feedback_ids",
                "open_reconciliation_ids",
                "open_secret_incident_ids",
            )
        )
        or not isinstance(open_gap_ids, list)
        or any(
            not isinstance(gap_id, str)
            or re.fullmatch(r"GAP-\d+", gap_id) is None
            for gap_id in open_gap_ids
        )
        or len(open_gap_ids) != len(set(open_gap_ids))
        or open_gap_ids
        != sorted(open_gap_ids, key=lambda value: value.encode("utf-8"))
        or not isinstance(test_prohibitions, list)
        or any(
            not isinstance(item, Mapping)
            or set(item) != {"id", "command", "source_ref", "affected_contract_ids", "fence"}
            or any(
                not isinstance(item.get(field), str) or not item[field]
                for field in ("id", "command")
            )
            or not isinstance(item.get("source_ref"), Mapping)
            or not _all_strings(item.get("affected_contract_ids"))
            or any(contract_id not in contracts for contract_id in item["affected_contract_ids"])
            or item.get("fence") != approved_fence
            for item in test_prohibitions
        )
        or not isinstance(residual_risks, list)
        or any(
            not isinstance(item, Mapping)
            or set(item)
            != {
                "id",
                "risk",
                "verification_status",
                "affected_contract_ids",
                "ui_ids",
            }
            or not isinstance(item.get("id"), str)
            or not item["id"]
            or not isinstance(item.get("risk"), str)
            or not item["risk"]
            or item.get("verification_status")
            not in {
                "source-verified",
                "runtime-verified",
                "runtime-unverified-prohibited",
                "runtime-unverified-unavailable",
            }
            or not isinstance(item.get("affected_contract_ids"), list)
            or any(
                contract_id not in contracts
                for contract_id in item["affected_contract_ids"]
            )
            or not isinstance(item.get("ui_ids"), list)
            or any(ui_id not in ui_mapping for ui_id in item["ui_ids"])
            or (not item["affected_contract_ids"] and not item["ui_ids"])
            for item in residual_risks
        )
        or len({item["id"] for item in residual_risks}) != len(residual_risks)
        or not isinstance(risk_acceptance, list)
        or any(
            not isinstance(item, Mapping)
            or set(item)
            != {"residual_risk_id", "authorization_id", "scope", "rationale"}
            or item.get("residual_risk_id")
            not in {risk["id"] for risk in residual_risks}
            or not isinstance(item.get("authorization_id"), str)
            or not item["authorization_id"]
            or not isinstance(item.get("scope"), str)
            or not item["scope"]
            or not isinstance(item.get("rationale"), str)
            or not item["rationale"]
            for item in risk_acceptance
        )
        or len({item["residual_risk_id"] for item in risk_acceptance})
        != len(risk_acceptance)
        or not isinstance(completion_criteria, list)
        or not completion_criteria
        or any(
            not isinstance(item, Mapping)
            or set(item) != {"id", "text", "obligation_ids"}
            or not isinstance(item.get("id"), str)
            or not item["id"]
            or not isinstance(item.get("text"), str)
            or not item["text"]
            or not _all_strings(item.get("obligation_ids"))
            or len(item["obligation_ids"]) != len(set(item["obligation_ids"]))
            for item in completion_criteria
        )
        or len({item["id"] for item in completion_criteria})
        != len(completion_criteria)
    ):
        raise RpfContractError("root authority inventories are incomplete")

    work_rows = _markdown_table_records(pointer_bytes, "Work queue")
    gap_rows = _markdown_table_records(pointer_bytes, "Goal gaps")
    reconciliation_rows = _markdown_table_records(pointer_bytes, "Reconciliation queue")
    secret_rows = _markdown_table_records(pointer_bytes, "Secret exposure incidents")
    feedback_rows = _markdown_table_records(pointer_bytes, "Feedback")
    active_run_rows = _markdown_table_records(pointer_bytes, "Active runs")
    if (
        any("ID" not in row or "Status" not in row for row in (*work_rows, *gap_rows))
        or any("ID" not in row or "Status" not in row for row in reconciliation_rows)
        or any("ID" not in row or "Status" not in row for row in secret_rows)
        or any("ID" not in row or "Disposition" not in row for row in feedback_rows)
        or any("Run ID" not in row for row in active_run_rows)
    ):
        raise RpfContractError("pointer convergence projections are incomplete")
    projected_open_work = sorted(
        {
            row["ID"]
            for row in work_rows
            if row["Status"].lower()
            in {"pending", "active", "integrated", "blocked"}
        },
        key=lambda value: value.encode("utf-8"),
    )
    projected_open_gaps = sorted(
        {row["ID"] for row in gap_rows if row["Status"].lower() == "open"},
        key=lambda value: value.encode("utf-8"),
    )
    terminal_projection_statuses = {
        "closed", "done", "resolved", "contained", "rotated", "refuted", "superseded",
    }
    projected_open_reconciliation = sorted(
        {
            row["ID"] for row in reconciliation_rows
            if row["Status"].lower() not in terminal_projection_statuses
        },
        key=lambda value: value.encode("utf-8"),
    )
    projected_open_secrets = sorted(
        {
            row["ID"] for row in secret_rows
            if row["Status"].lower() not in terminal_projection_statuses
        },
        key=lambda value: value.encode("utf-8"),
    )
    if any(
        row["Disposition"].lower() not in {"deferred", "refuted"}
        and re.fullmatch(r"RPF-[0-9]+", row["Disposition"]) is None
        for row in feedback_rows
    ):
        raise RpfContractError(
            "feedback must be promoted, deferred, or refuted before capture"
        )
    work_by_id = {row["ID"]: row for row in work_rows}
    if len(work_by_id) != len(work_rows):
        raise RpfConflictError("work projection IDs are duplicated")
    for feedback in feedback_rows:
        work_id = feedback["Disposition"]
        if re.fullmatch(r"RPF-[0-9]+", work_id) is None:
            continue
        work = work_by_id.get(work_id)
        feedback_digest = hashlib.sha256(
            feedback.get("Feedback", "").encode("utf-8")
        ).hexdigest()
        binding = f"feedback-link:{feedback['ID']}:{feedback_digest}"
        work_text = "\n".join(
            work.get(field, "") for field in ("Task", "Acceptance criteria")
        ) if work is not None else ""
        if (
            work is None
            or work.get("Status", "").lower()
            not in {"pending", "active", "integrated", "blocked"}
            or binding not in work_text
        ):
            raise RpfContractError(
                "promoted feedback requires a nonterminal content-bound work row"
            )
    projected_open_feedback: list[str] = []
    active_peer_ids = sorted(
        {
            row["Run ID"] for row in active_run_rows
            if row["Run ID"] != root_authority["run_id"]
        },
        key=lambda value: value.encode("utf-8"),
    )
    if (
        projected_open_work != convergence_state["open_work_ids"]
        or projected_open_gaps != open_gap_ids
        or projected_open_feedback != convergence_state["open_feedback_ids"]
        or projected_open_reconciliation
        != convergence_state["open_reconciliation_ids"]
        or projected_open_secrets != convergence_state["open_secret_incident_ids"]
    ):
        raise RpfContractError(
            "pointer convergence projections differ from machine authority"
        )

    source_index = build_source_index(source_bytes)
    derived_source_contracts = derive_source_contract_inventory(
        source_bytes,
        base=approved_fence[0],
        repository_root=repository_root,
    )
    derived_contracts = derived_source_contracts["contracts"]
    derived_gates = derived_source_contracts["gates"]
    derived_prohibitions = derived_source_contracts["prohibitions"]
    gates_by_id = {gate["id"]: gate for gate in gates}
    prohibited_commands = {
        item["command"] for item in derived_prohibitions.values()
    }
    if (
        dict(contracts) != derived_contracts
        or len(gates_by_id) != len(gates)
        or (
            bool(derived_gates)
            and set(gates_by_id) != set(derived_gates)
        )
        or (
            not derived_gates
            and gates
            != [{
                "id": "GATE-NONE",
                "classification": "not-applicable",
                "affected_contract_ids": [],
                "fence": approved_fence,
            }]
        )
        or any(
            gates_by_id[gate_id]["affected_contract_ids"]
            != declaration["affected_contract_ids"]
            or (
                declaration["command"] in prohibited_commands
                and gates_by_id[gate_id]["classification"]
                != "not-run-prohibited"
            )
            or (
                declaration["command"] not in prohibited_commands
                and gates_by_id[gate_id]["classification"]
                != "not-run-unavailable"
            )
            for gate_id, declaration in derived_gates.items()
        )
    ):
        raise RpfContractError(
            "source contracts and configured gates differ from typed source"
        )
    expected_prohibitions = [
        {
            "id": item["id"],
            "command": item["command"],
            "source_ref": {
                "path": item["path"],
                "line": item["line"],
                "symbol": item["symbol"],
                "command_sha256": hashlib.sha256(
                    item["command"].encode("utf-8")
                ).hexdigest(),
            },
            "affected_contract_ids": item["affected_contract_ids"],
            "fence": approved_fence,
        }
        for _, item in sorted(derived_prohibitions.items())
    ]
    if test_prohibitions != expected_prohibitions:
        raise RpfContractError(
            "test prohibitions differ from typed repository declarations"
        )
    if not recovery_snapshot:
        recovery_snapshot = AdaptiveRecoveryLedger(
            total_cycles=recovery_state["total_cycles"],
            start_cycle=recovery_state["start_cycle"],
        ).snapshot()
    try:
        recovery_payload = json.loads(
            recovery_snapshot.decode("utf-8", errors="strict"),
            object_pairs_hook=_strict_pairs,
            parse_constant=_reject_json_constant,
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        _DuplicateKey,
        RpfContractError,
        RecursionError,
        TypeError,
        ValueError,
    ) as error:
        raise RpfContractError("root recovery snapshot is malformed") from error
    if (
        not isinstance(recovery_payload, Mapping)
        or recovery_payload.get("format") != "rpf-adaptive-recovery-v1"
        or not isinstance(recovery_payload.get("rows"), Mapping)
        or recovery_state["snapshot_sha256"]
        != hashlib.sha256(recovery_snapshot).hexdigest()
        or sorted(recovery_state["unresolved_units"])
        != sorted(
            unit_id
            for unit_id, row in recovery_payload["rows"].items()
            if isinstance(row, Mapping) and row.get("accepted") is False
        )
        or any(
            not isinstance(row, Mapping) or type(row.get("accepted")) is not bool
            for row in recovery_payload["rows"].values()
        )
    ):
        raise RpfContractError("root recovery state differs from its snapshot")
    if any(
        not all(
            source_ref_valid(ref, source_index, approved_fence, repository_root)
            for ref in row["refs"]
        )
        for row in persona_evidence.values()
    ):
        raise RpfContractError("persona evidence is not source grounded")
    combined_source = b"\n".join(source_bytes.values()).lower()
    required_personas = {
        persona
        for persona, markers in {
            "security": (b"auth", b"password", b"session", b"credential"),
            "frontend": (b"<div", b"<button", b"aria-", b"viewport"),
            "database": (b"database", b"sql", b"transaction"),
            "observability": (b"metric", b"trace", b"logging"),
        }.items()
        if any(marker in combined_source for marker in markers)
    }
    if not required_personas.issubset(personas):
        raise RpfContractError("an applicable bundled persona was omitted")
    available_repository_roles = {
        Path(path).stem
        for path in source_bytes
        if (
            path.startswith(".claude/agents/") or path.startswith(".agents/")
        )
        and Path(path).suffix == ".md"
        and len(Path(path).parts) == 3
    }
    if any(role not in available_repository_roles for role in repository_roles):
        raise RpfContractError("repository role has no exact repository definition")
    authorizations_by_id = {
        authorization.authorization_id: authorization
        for authorization in user_authorizations
        if (
            _user_authorization_valid(authorization)
        )
    }
    if len(authorizations_by_id) != len(user_authorizations) or any(
        not isinstance(authorization := authorizations_by_id.get(item["authorization_id"]), UserAuthorization)
        or authorization.residual_risk_id != item["residual_risk_id"]
        or authorization.scope != item["scope"]
        or authorization.rationale != item["rationale"]
        for item in risk_acceptance
    ):
        raise RpfContractError("risk acceptance lacks sealed explicit user authority")
    if topology != derive_game_topology(source_bytes):
        raise RpfContractError("game topology is not derived from approved source")
    required_inventory = required_game_inventory_paths(source_bytes, repository_root)
    if any(path not in source_bytes for path in required_inventory):
        raise RpfContractError("game metadata inventory is incomplete")
    if incident_coverage != derive_incident_coverage(source_bytes):
        raise RpfContractError("incident coverage is not derived from approved source")
    if dict(ui_mapping) != derive_ui_mapping(source_bytes):
        raise RpfContractError("UI applicability is not derived from approved source")

    no_ui_fields = {
        "id",
        "status",
        "kind",
        "evidence",
        "cycle",
        "run",
        "dispatch",
        "fence",
    }
    if ui_mapping:
        if (
            set(ui_mapping.values()) != set(UI_KINDS)
            or no_ui_detection is not None
        ):
            raise RpfContractError("UI authority is incomplete")
    elif (
        not isinstance(no_ui_detection, Mapping)
        or set(no_ui_detection) != no_ui_fields
        or not isinstance(no_ui_detection.get("id"), str)
        or not no_ui_detection["id"]
        or no_ui_detection.get("status") != "not-applicable"
        or no_ui_detection.get("kind") != "no-ui-detection"
        or not isinstance(no_ui_detection.get("evidence"), str)
        or not no_ui_detection["evidence"]
        or no_ui_detection.get("cycle") != root_authority["cycle"]
        or no_ui_detection.get("run") != root_authority["run_id"]
        or not isinstance(no_ui_detection.get("dispatch"), str)
        or not no_ui_detection["dispatch"]
        or no_ui_detection.get("fence") != approved_fence
    ):
        raise RpfContractError("no-UI authority is incomplete")

    runtime_fields = {
        "id",
        "immutable",
        "cycle",
        "run",
        "fence",
        "runner",
        "snapshot_id",
        "command",
        "action",
        "expected",
        "observed",
        "result",
    }
    for record_id, record in runtime_records.items():
        if (
            not isinstance(record_id, str)
            or not record_id
            or not isinstance(record, Mapping)
            or set(record) != runtime_fields
            or record.get("id") != record_id
            or record.get("immutable") is not True
            or record.get("cycle") != root_authority["cycle"]
            or record.get("run") != root_authority["run_id"]
            or record.get("fence") != approved_fence
            or not isinstance(record.get("result"), str)
            or record["result"] not in {"passed", "failed"}
            or any(
                not isinstance(record.get(field), str) or not record[field]
                for field in (
                    "runner",
                    "snapshot_id",
                    "command",
                    "action",
                    "expected",
                    "observed",
                )
            )
            or (
                record["result"] == "passed"
                and record["observed"] != record["expected"]
            )
        ):
            raise RpfContractError("runtime record authority is incomplete")

    receipts_by_record = {
        receipt.record_id: receipt
        for receipt in runtime_receipts
        if _runtime_receipt_valid(receipt)
    }
    if len(receipts_by_record) != len(runtime_receipts):
        raise RpfContractError("runtime receipt identities are duplicated")
    attested_records = {
        **runtime_records,
        **backup_records,
        **backup_comparisons,
    }
    if set(receipts_by_record) != set(attested_records) or set(
        persisted_receipts
    ) != set(attested_records):
        raise RpfContractError("runtime/backup records lack exact provider receipts")
    for record_id, record in attested_records.items():
        canonical_record = json.dumps(
            record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        digest = hashlib.sha256(canonical_record).hexdigest()
        receipt = receipts_by_record[record_id]
        persisted = persisted_receipts.get(record_id)
        if (
            receipt.record_sha256 != digest
            or not isinstance(persisted, Mapping)
            or set(persisted) != {"record_sha256", "provider_id"}
            or persisted.get("record_sha256") != digest
            or persisted.get("provider_id") != receipt.provider_id
        ):
            raise RpfContractError("provider receipt does not bind exact record bytes")

    ui_result_fields = {
        "id",
        "ui_id",
        "status",
        "evidence_kind",
        "runtime_record_id",
        "cycle",
        "run",
        "dispatch",
        "fence",
    }
    if (
        any(
            not isinstance(row, Mapping)
            or set(row) != ui_result_fields
            or not isinstance(row.get("id"), str)
            or not row["id"]
            or row.get("ui_id") not in ui_mapping
            or row.get("status")
            not in {
                "verified",
                "failed",
                "unverified-prohibited",
                "unverified-unavailable",
                "not-applicable",
            }
            or row.get("evidence_kind") not in {"runtime", "static", "none"}
            or not isinstance(row.get("runtime_record_id"), str)
            or row.get("cycle") != root_authority["cycle"]
            or row.get("run") != root_authority["run_id"]
            or not isinstance(row.get("dispatch"), str)
            or not row["dispatch"]
            or row.get("fence") != approved_fence
            or (
                row.get("status") == "verified"
                and (
                    row.get("evidence_kind") != "runtime"
                    or row.get("runtime_record_id") not in runtime_records
                    or runtime_records[row["runtime_record_id"]]["result"]
                    != "passed"
                )
            )
            or (row.get("status") == "not-applicable" and ui_mapping)
            or (
                row.get("status") not in {"verified", "not-applicable"}
                and row.get("evidence_kind") == "runtime"
                and row.get("runtime_record_id") in runtime_records
                and runtime_records[row["runtime_record_id"]]["result"] == "passed"
            )
            for row in ui_runtime_results
        )
        or len({row["id"] for row in ui_runtime_results})
        != len(ui_runtime_results)
        or {row["ui_id"] for row in ui_runtime_results} != set(ui_mapping)
    ):
        raise RpfContractError("UI runtime result authority is incomplete")

    validated_ui_results = tuple(
        result
        for result in validated_results
        if validated_child_result(result)
        and result.envelope.get("kind") == "ui-runtime"
        and result.envelope.get("cycle") == root_authority["cycle"]
        and result.envelope.get("run_id") == root_authority["run_id"]
        and result.envelope.get("role_instance") == "ui-runtime-verifier"
    )
    verified_rows = [row for row in ui_runtime_results if row["status"] == "verified"]
    expected_ui_pairs = {
        *(("source", path) for path in sorted(source_bytes)),
        *(("topology", f"topology:{family}") for family in GAME_FAMILIES),
        *(("incident", f"incident:{family}") for family in INCIDENT_FAMILIES),
        *(
            ("probe", claim_id)
            for claim_id, claim in claims.items()
            if isinstance(claim, Mapping)
            and claim.get("role_instance") == "ui-runtime-verifier"
        ),
        *(("ui", ui_id) for ui_id in ui_mapping),
    }
    expected_ui_coverage = tuple(
        obligation_id for _, obligation_id in sorted(expected_ui_pairs)
    )
    for row in verified_rows:
        record = runtime_records[row["runtime_record_id"]]
        canonical_record = json.dumps(
            record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        receipt = receipts_by_record.get(row["runtime_record_id"])
        if (
            not _runtime_receipt_valid(receipt)
            or receipt.record_sha256 != hashlib.sha256(canonical_record).hexdigest()
            or receipt.provider_id != record["runner"]
        ):
            raise RpfContractError("verified UI lacks a sealed runtime provider receipt")
    if any(
        row["status"] == "verified"
        and not any(
            isinstance(dispatch_ledger, DispatchLedger)
            and result.envelope.get("dispatch_id") == row["dispatch"]
            and dispatch_ledger.publication_authorized(row["dispatch"], result)
            and dispatch_ledger.snapshot(row["dispatch"]).get(
                "expected_obligation_ids"
            )
            == expected_ui_coverage
            and (
                result.envelope["fence"]["base"],
                tuple(result.envelope["fence"]["scope"]),
                result.envelope["fence"]["hash"],
            )
            == approved_fence
            and authority_digest(
                {"rows": result.envelope["payload"].get("ui_rows", ())}
            )
            == authority_digest({"rows": ui_runtime_results})
            and tuple(
                item.get("obligation_id")
                for item in result.envelope["payload"].get("coverage", ())
            )
            == expected_ui_coverage
            for result in validated_ui_results
        )
        for row in ui_runtime_results
    ):
        raise RpfContractError("UI runtime verification lacks a sealed child result")

    unresolved_ui_ids = {
        row["ui_id"]
        for row in ui_runtime_results
        if row["status"] not in {"verified", "not-applicable"}
    }
    risk_ui_ids = {
        ui_id for risk in residual_risks for ui_id in risk["ui_ids"]
    }
    if unresolved_ui_ids != risk_ui_ids:
        raise RpfContractError("UI runtime residual risk is not separated")

    backup_record_fields = {
        "id",
        "immutable",
        "cycle",
        "run",
        "fence",
        "kind",
        "endpoint",
        "schema",
        "version",
        "content",
        "ordering",
    }
    for record_id, record in backup_records.items():
        if (
            not isinstance(record_id, str)
            or not record_id
            or not isinstance(record, Mapping)
            or set(record) != backup_record_fields
            or record.get("id") != record_id
            or record.get("immutable") is not True
            or record.get("cycle") != root_authority["cycle"]
            or record.get("run") != root_authority["run_id"]
            or record.get("fence") != approved_fence
            or not isinstance(record.get("kind"), str)
            or record["kind"] not in {"export", "import"}
            or any(
                not isinstance(record.get(field), str) or not record[field]
                for field in ("endpoint", "schema", "version", "content", "ordering")
            )
        ):
            raise RpfContractError("backup record authority is incomplete")

    comparison_fields = {
        "id",
        "immutable",
        "cycle",
        "run",
        "fence",
        "export_record_id",
        "import_record_id",
        "result",
    }
    for comparison_id, comparison in backup_comparisons.items():
        if (
            not isinstance(comparison_id, str)
            or not comparison_id
            or not isinstance(comparison, Mapping)
            or set(comparison) != comparison_fields
            or comparison.get("id") != comparison_id
            or comparison.get("immutable") is not True
            or comparison.get("cycle") != root_authority["cycle"]
            or comparison.get("run") != root_authority["run_id"]
            or comparison.get("fence") != approved_fence
            or comparison.get("result") != "equal"
            or not isinstance(comparison.get("export_record_id"), str)
            or not comparison["export_record_id"]
            or not isinstance(comparison.get("import_record_id"), str)
            or not comparison["import_record_id"]
            or comparison["export_record_id"] == comparison["import_record_id"]
        ):
            raise RpfContractError("backup comparison authority is incomplete")
        exported = backup_records.get(comparison["export_record_id"])
        imported = backup_records.get(comparison["import_record_id"])
        if (
            not isinstance(exported, Mapping)
            or not isinstance(imported, Mapping)
            or exported.get("kind") != "export"
            or imported.get("kind") != "import"
            or any(
                exported.get(field) != imported.get(field)
                for field in ("schema", "version", "content", "ordering")
            )
        ):
            raise RpfContractError("backup comparison links are incomplete")

    required_roles = {
        "pointer-alignment",
        "plan-doc-consistency",
        "aggregate-result-falsifier",
        *(f"conclusion-blind-persona:{persona}" for persona in personas),
        *repository_roles,
    }
    affected_contracts = {
        contract_id
        for contract_id, contract in contracts.items()
        if contract["changed"]
    } | {
        contract_id
        for gate in gates
        if gate["classification"] in {"not-run-prohibited", "not-run-unavailable"}
        for contract_id in gate["affected_contract_ids"]
        if contracts[contract_id]["still_current"]
    } | {
        contract_id
        for prohibition in test_prohibitions
        for contract_id in prohibition["affected_contract_ids"]
        if contracts[contract_id]["still_current"]
    }
    carried_watches = carry_open_watches(
        watches,
        approved_fence,
        current_cycle=root_authority["cycle"],
        current_run_id=root_authority["run_id"],
        validated_results=validated_results,
        dispatch_ledger=dispatch_ledger,
    )
    if carried_watches != watches:
        raise RpfContractError("open watches must be carried before authority capture")
    if any(watch["status"] == "open" for watch in watches):
        required_roles.add("regression-falsifier")
    if affected_contracts:
        required_roles.add("source-contract-verifier")
    if ui_mapping:
        required_roles.add("ui-runtime-verifier")

    claim_obligations: dict[str, list[tuple[str, str]]] = {
        role: [] for role in required_roles
    }
    for claim_id, claim in claims.items():
        if (
            not isinstance(claim_id, str)
            or not claim_id.startswith("claim:")
            or not isinstance(claim, Mapping)
            or set(claim) != {"role_instance", "claim", "refs"}
            or not isinstance(claim.get("role_instance"), str)
            or claim.get("role_instance") not in required_roles
            or not isinstance(claim.get("claim"), str)
            or not claim["claim"]
            or not isinstance(claim.get("refs"), list)
            or not claim["refs"]
            or not all(
                source_ref_valid(
                    ref, source_index, approved_fence, repository_root
                )
                for ref in claim["refs"]
            )
        ):
            raise RpfContractError("aggregate claim inventory is incomplete")
        claim_obligations[claim["role_instance"]].append(("probe", claim_id))
    if any(not obligations for obligations in claim_obligations.values()):
        raise RpfContractError("every required role instance needs captured claims")

    canonical_root = copy.deepcopy(dict(root_authority))
    digest = authority_digest(canonical_root)
    base_obligations = (
        *(("source", path) for path in sorted(source_bytes)),
        *(("topology", f"topology:{family}") for family in GAME_FAMILIES),
        *(("incident", f"incident:{family}") for family in INCIDENT_FAMILIES),
    )
    for role in claim_obligations:
        claim_obligations[role].extend(base_obligations)
        if role == "ui-runtime-verifier":
            claim_obligations[role].extend(
                ("ui", ui_id) for ui_id in sorted(ui_mapping)
            )
        if role == "regression-falsifier":
            claim_obligations[role].extend(
                ("regression", watch["id"]) for watch in watches
            )
        if role == "source-contract-verifier":
            claim_obligations[role].extend(
                ("source-contract", contract_id)
                for contract_id in sorted(affected_contracts)
            )
    aggregate_role = "aggregate-result-falsifier"
    aggregate_full = {
        obligation
        for obligations in claim_obligations.values()
        for obligation in obligations
    }
    aggregate_full.update(base_obligations)
    claim_obligations[aggregate_role] = list(aggregate_full)
    aggregate_obligation_ids = {item[1] for item in aggregate_full}
    if any(
        any(
            obligation_id not in aggregate_obligation_ids
            for obligation_id in criterion["obligation_ids"]
        )
        for criterion in completion_criteria
    ):
        raise RpfContractError(
            "completion criteria lack authoritative evidence obligations"
        )
    return {
        "immutable": True,
        "root_revision": root_authority["pointer_revision"],
        "root_hash": hashlib.sha256(pointer_bytes).hexdigest(),
        "fence": approved_fence,
        "capture_digest": digest,
        "required_role_instances": tuple(sorted(required_roles)),
        "affected_contract_ids": tuple(sorted(affected_contracts)),
        "claim_obligations": {
            role: tuple(sorted(set(obligations)))
            for role, obligations in sorted(claim_obligations.items())
        },
        "topology": canonical_root["topology"],
        "regression_watches": canonical_root["regression_watches"],
        "ui_mapping": canonical_root["ui_mapping"],
        "no_ui_detection": canonical_root["no_ui_detection"],
        "ui_runtime_results": canonical_root["ui_runtime_results"],
        "runtime_records": canonical_root["runtime_records"],
        "persisted_runtime_receipts": canonical_root["runtime_receipts"],
        "backup_records": canonical_root["backup_records"],
        "backup_comparisons": canonical_root["backup_comparisons"],
        "incident_coverage": canonical_root["incident_coverage"],
        "recovery_state": canonical_root["recovery_state"],
        "convergence_state": canonical_root["convergence_state"],
        "open_gap_ids": tuple(canonical_root["open_gap_ids"]),
        "test_prohibitions": canonical_root["test_prohibitions"],
        "residual_risks": canonical_root["residual_risks"],
        "risk_acceptance": canonical_root["risk_acceptance"],
        "completion_criteria": canonical_root["completion_criteria"],
        "active_peer_ids": tuple(active_peer_ids),
        "root_authority": canonical_root,
        "pointer_bytes": pointer_bytes,
        "source_bytes": dict(source_bytes),
        "repository_root": os.fspath(repository_root.resolve(strict=True)),
        "validated_results": tuple(validated_results),
        "user_authorizations": tuple(user_authorizations),
        "runtime_receipts": tuple(runtime_receipts),
        "recovery_snapshot": recovery_snapshot,
        "dispatch_ledger": dispatch_ledger,
    }


def captured_authority_valid(captured: object) -> bool:
    try:
        if not isinstance(captured, Mapping):
            return False
        if _has_registered_identity(_AUDIT_CAPTURE_REGISTRY, captured):
            issued = _ISSUED_FINGERPRINTS.get(id(captured))
            return bool(
                issued is not None
                and issued
                == (
                    captured.get("fence"),
                    scope_digest(
                        captured.get("fence", (None, (), None))[1],
                        captured.get("source_bytes", {}),
                    ),
                    captured.get("root_authority", {}).get("run_id"),
                    captured.get("required_role_instances"),
                    captured.get("claim_obligations"),
                )
                and captured.get("mode") == AUDIT_MODE
                and captured.get("root_authority", {}).get("cycle") == 0
            )
        rebuilt = capture_authority(
            captured.get("pointer_bytes"),
            captured.get("fence"),
            captured.get("source_bytes"),
            Path(captured.get("repository_root")),
            validated_results=captured.get("validated_results", ()),
            user_authorizations=captured.get("user_authorizations", ()),
            runtime_receipts=captured.get("runtime_receipts", ()),
            recovery_snapshot=captured.get("recovery_snapshot", b""),
            dispatch_ledger=captured.get("dispatch_ledger"),
        )
        return rebuilt == captured
    except (RpfContractError, OSError, TypeError, ValueError):
        return False


def capture_audit_authority(
    approved_fence: tuple[str, tuple[str, ...], str],
    source_bytes: Mapping[str, bytes],
    repository_root: Path,
    *,
    run_id: str,
    dispatch_ledger: DispatchLedger,
) -> Mapping[str, Any]:
    """Create an ephemeral, process-sealed cycle-0 authority for audit mode."""

    if (
        not isinstance(run_id, str)
        or not run_id
        or not isinstance(dispatch_ledger, DispatchLedger)
    ):
        raise RpfContractError("audit run identity is invalid")
    canonical_fence(
        approved_fence[0],
        approved_fence[1],
        approved_fence[2],
        source_bytes,
        repository_root=repository_root,
    )
    required_inventory = required_game_inventory_paths(source_bytes, repository_root)
    if any(path not in source_bytes for path in required_inventory):
        raise RpfContractError("audit game metadata inventory is incomplete")
    combined = b"\n".join(source_bytes.values()).lower()
    personas = {
        "security"
        if any(marker in combined for marker in (b"auth", b"password", b"session"))
        else "code-quality",
        "testing",
    }
    topology = derive_game_topology(source_bytes)
    incident_coverage = derive_incident_coverage(source_bytes)
    ui_mapping = derive_ui_mapping(source_bytes)
    source_contract_inventory = derive_source_contract_inventory(
        source_bytes,
        base=approved_fence[0],
        repository_root=repository_root,
    )
    contracts = source_contract_inventory["contracts"]
    prohibited_commands = {
        item["command"]
        for item in source_contract_inventory["prohibitions"].values()
    }
    gate_results = [
        {
            "id": item["id"],
            "classification": (
                "not-run-prohibited"
                if item["command"] in prohibited_commands
                else "not-run-unavailable"
            ),
            "affected_contract_ids": item["affected_contract_ids"],
            "fence": approved_fence,
        }
        for _, item in sorted(source_contract_inventory["gates"].items())
    ] or [{
        "id": "GATE-NONE",
        "classification": "not-applicable",
        "affected_contract_ids": [],
        "fence": approved_fence,
    }]
    affected_contracts = {
        contract_id
        for contract_id, contract in contracts.items()
        if contract["changed"]
    } | {
        contract_id
        for item in source_contract_inventory["prohibitions"].values()
        for contract_id in item["affected_contract_ids"]
    } | {
        contract_id
        for gate in gate_results
        if gate["classification"] in {"not-run-prohibited", "not-run-unavailable"}
        for contract_id in gate["affected_contract_ids"]
    }
    roles = {
        "pointer-alignment",
        "plan-doc-consistency",
        "aggregate-result-falsifier",
        *(f"conclusion-blind-persona:{persona}" for persona in personas),
    }
    if affected_contracts:
        roles.add("source-contract-verifier")
    audit_base = {
        *(("source", path) for path in sorted(source_bytes)),
        *(("topology", f"topology:{family}") for family in GAME_FAMILIES),
        *(("incident", f"incident:{family}") for family in INCIDENT_FAMILIES),
    }
    obligations = {
        role: tuple(sorted({*audit_base, ("audit", f"audit:{role}")}))
        for role in sorted(roles)
    }
    all_atomic = {
        *(item for values in obligations.values() for item in values),
        *(("source", path) for path in sorted(source_bytes)),
        *(("topology", f"topology:{family}") for family in GAME_FAMILIES),
        *(("incident", f"incident:{family}") for family in INCIDENT_FAMILIES),
    }
    obligations["aggregate-result-falsifier"] = tuple(sorted(all_atomic))
    if "source-contract-verifier" in obligations:
        obligations["source-contract-verifier"] = tuple(sorted({
            *obligations["source-contract-verifier"],
            *(("source-contract", contract_id) for contract_id in affected_contracts),
        }))
        obligations["aggregate-result-falsifier"] = tuple(sorted({
            *obligations["aggregate-result-falsifier"],
            *(("source-contract", contract_id) for contract_id in affected_contracts),
        }))
    audit_root = {
        "cycle": 0,
        "run_id": run_id,
        "aggregate_claims": {},
        "topology": topology,
        "incident_coverage": incident_coverage,
        "regression_watches": [],
        "contracts": contracts,
        "gate_results": gate_results,
        "ui_mapping": ui_mapping,
        "ui_runtime_results": [],
        "residual_risks": [],
        "risk_acceptance": [],
        "convergence_state": {
            "open_work_ids": [],
            "open_feedback_ids": [],
            "open_reconciliation_ids": [],
            "open_secret_incident_ids": [],
        },
    }
    captured = _freeze_json({
        "immutable": True,
        "mode": AUDIT_MODE,
        "root_revision": 0,
        "root_hash": hashlib.sha256(
            authority_digest(audit_root).encode("ascii")
        ).hexdigest(),
        "capture_digest": authority_digest(audit_root),
        "fence": approved_fence,
        "required_role_instances": tuple(sorted(roles)),
        "affected_contract_ids": tuple(sorted(affected_contracts)),
        "claim_obligations": obligations,
        "topology": topology,
        "incident_coverage": incident_coverage,
        "regression_watches": (),
        "ui_mapping": ui_mapping,
        "open_gap_ids": (),
        "root_authority": audit_root,
        "source_bytes": dict(source_bytes),
        "repository_root": os.fspath(repository_root.resolve(strict=True)),
        "dispatch_ledger": dispatch_ledger,
    })
    if not isinstance(captured, Mapping):
        raise RpfContractError("audit authority could not be frozen")
    _register_identity(_AUDIT_CAPTURE_REGISTRY, captured)
    _record_fingerprint(
        captured,
        approved_fence,
        scope_digest(approved_fence[1], source_bytes),
        run_id,
        captured["required_role_instances"],
        captured["claim_obligations"],
    )
    return captured


def coverage_obligations_for_role(
    captured: Mapping[str, Any], role_instance: str
) -> tuple[tuple[str, str], ...]:
    if (
        not isinstance(captured, Mapping)
        or captured.get("immutable") is not True
        or not captured_authority_valid(captured)
    ):
        raise RpfContractError("captured authority is not sealed")
    mapping = captured.get("claim_obligations")
    if not isinstance(mapping, Mapping) or role_instance not in mapping:
        raise RpfContractError("role instance is not authoritative")
    obligations = mapping[role_instance]
    if not isinstance(obligations, tuple) or not obligations:
        raise RpfContractError("role claim inventory is incomplete")
    return obligations


def _source_ref_token(ref: Mapping[str, Any]) -> str:
    return f"source-ref:{ref['path']}:{ref['line']}:{ref['symbol']}"


def _required_evidence_tokens(
    captured: Mapping[str, Any], kind: str, obligation_id: str
) -> tuple[tuple[str, ...], bool]:
    root = captured["root_authority"]
    if kind == "source":
        data = captured["source_bytes"].get(obligation_id)
        if not isinstance(data, bytes):
            raise RpfContractError("source evidence obligation is unavailable")
        required = (f"source:{obligation_id}:{hashlib.sha256(data).hexdigest()}",)
        return required, False
    if kind in {"topology", "incident"}:
        family = obligation_id.removeprefix(f"{kind}:")
        inventory = root["topology" if kind == "topology" else "incident_coverage"]
        authority = inventory.get(family)
        if not isinstance(authority, Mapping):
            raise RpfContractError("derived evidence obligation is unavailable")
        required = tuple(_source_ref_token(ref) for ref in authority["refs"])
        return required, authority["applicable"] is False
    if kind == "probe":
        claim = root["aggregate_claims"].get(obligation_id)
        if not isinstance(claim, Mapping):
            raise RpfContractError("claim evidence obligation is unavailable")
        return tuple(_source_ref_token(ref) for ref in claim["refs"]), False
    if kind == "regression":
        watches = {watch["id"]: watch for watch in root["regression_watches"]}
        watch = watches.get(obligation_id.removeprefix("watch:"), watches.get(obligation_id))
        if not isinstance(watch, Mapping):
            raise RpfContractError("regression evidence obligation is unavailable")
        return (f"watch:{watch['id']}",), False
    if kind == "ui":
        return (f"ui:{obligation_id}",), False
    if kind == "source-contract":
        return (f"source-contract:{obligation_id}",), False
    if kind == "audit":
        return (obligation_id,), False
    raise RpfContractError("unknown evidence obligation kind")


def _coverage_evidence_valid(
    captured: Mapping[str, Any],
    role: str,
    result: ValidatedChildResult,
    *,
    expected_pairs: Sequence[tuple[str, str]] | None = None,
) -> bool:
    """Bind terminal coverage to exact captured source-derived evidence tokens."""

    if expected_pairs is None:
        expected_pairs = coverage_obligations_for_role(captured, role)
    rows = result.envelope.get("payload", {}).get("coverage", ())
    if len(rows) != len(expected_pairs):
        return False
    for (kind, obligation_id), row in zip(expected_pairs, rows):
        evidence = row.get("evidence", ())
        try:
            required, allow_not_applicable = _required_evidence_tokens(
                captured, kind, obligation_id
            )
        except RpfContractError:
            return False
        if tuple(evidence) != required or len(evidence) != len(set(evidence)):
            return False
        if row.get("disposition") == "not-applicable":
            if not allow_not_applicable:
                return False
        elif row.get("disposition") != "verified":
            return False
    return True


def evaluate_cycle_evidence(
    captured: Mapping[str, Any],
    results: Sequence[ValidatedChildResult],
    *,
    dispatch_ledger: DispatchLedger,
    recovery_ledger: AdaptiveRecoveryLedger,
    completed_recovery_cycle: int | None = None,
) -> Mapping[str, Any]:
    """Production reducer for one complete independent review/falsification cycle."""

    audit_mode = captured.get("mode") == AUDIT_MODE
    if (
        not captured_authority_valid(captured)
        or not isinstance(results, Sequence)
        or any(not validated_child_result(result) for result in results)
        or not isinstance(dispatch_ledger, DispatchLedger)
        or dispatch_ledger is not captured.get("dispatch_ledger")
        or not isinstance(recovery_ledger, AdaptiveRecoveryLedger)
        or (
            completed_recovery_cycle is not None
            and (
                type(completed_recovery_cycle) is not int
                or completed_recovery_cycle < recovery_ledger._start_cycle
                or completed_recovery_cycle > recovery_ledger._limit_cycle
                or completed_recovery_cycle
                != captured.get("root_authority", {}).get("cycle")
            )
        )
        or (
            not audit_mode
            and recovery_ledger.snapshot() != captured.get("recovery_snapshot")
        )
    ):
        raise RpfContractError("cycle evidence input is malformed")
    root = captured["root_authority"]
    by_role: dict[str, list[ValidatedChildResult]] = {
        role: [] for role in captured["required_role_instances"]
    }
    for result in results:
        role = result.envelope.get("role_instance")
        if role not in by_role:
            raise RpfContractError("cycle result role is not authoritative")
        serialized = result.envelope["fence"]
        result_fence = (
            serialized["base"], tuple(serialized["scope"]), serialized["hash"]
        )
        dispatch_id = result.envelope.get("dispatch_id")
        expected_kind = (
            "aggregate"
            if role == "aggregate-result-falsifier"
            else "regression"
            if role == "regression-falsifier"
            else "source-contract"
            if role == "source-contract-verifier"
            else "ui-runtime"
            if role == "ui-runtime-verifier"
            else "review"
        )
        if (
            result.envelope.get("cycle") != root["cycle"]
            or result.envelope.get("run_id") != root["run_id"]
            or result_fence != captured["fence"]
            or not dispatch_ledger.publication_authorized(dispatch_id, result)
            or result.envelope.get("kind") != expected_kind
            or result.envelope.get("status")
            not in (
                {"passed", "verified", "findings", "failed", "not-applicable"}
                if audit_mode
                else (
                    {"not-applicable"}
                    if expected_kind == "ui-runtime"
                    and result.envelope.get("status") == "not-applicable"
                    else {"passed", "verified"}
                )
            )
        ):
            raise RpfContractError("cycle result authority is stale or unsuccessful")
        expected = tuple(
            obligation_id
            for _, obligation_id in coverage_obligations_for_role(captured, role)
        )
        returned = tuple(
            row.get("obligation_id")
            for row in result.envelope.get("payload", {}).get("coverage", ())
        )
        if returned != expected:
            raise RpfContractError("cycle result atomic coverage is incomplete")
        if not _coverage_evidence_valid(captured, role, result):
            raise RpfContractError("cycle result evidence is not source grounded")
        payload = result.envelope.get("payload", {})
        if (
            not audit_mode
            and expected_kind in {"review", "aggregate"}
            and (
                tuple(payload.get("findings", ())) != ()
                or (
                    expected_kind == "aggregate"
                    and payload.get("verdict") != "clean"
                )
            )
        ):
            raise RpfContractError("clean cycle result contains unresolved findings")
        by_role[role].append(result)
    missing_or_duplicate = tuple(
        role for role, accepted in by_role.items() if len(accepted) != 1
    )
    missing_role_obligations = frozenset(
        f"{role}::{obligation_id}"
        for role in missing_or_duplicate
        for _, obligation_id in coverage_obligations_for_role(captured, role)
    )
    terminal_recovery_coverage = (
        recovery_ledger.completed_cycle_coverage(
            completed_recovery_cycle, dispatch_ledger=dispatch_ledger
        )
        if completed_recovery_cycle is not None
        else frozenset()
    )
    limit_exhaustion_evidenced = bool(
        completed_recovery_cycle == recovery_ledger._limit_cycle
        and (
            not missing_or_duplicate
            or missing_role_obligations <= terminal_recovery_coverage
        )
    )
    open_watches = sum(
        watch["status"] == "open" for watch in captured["regression_watches"]
    )
    topology_frontier = len({
        path
        for row in captured["topology"].values()
        for path in row.get("frontier", ())
    })
    source_result = next(
        (
            accepted[0]
            for role, accepted in by_role.items()
            if role == "source-contract-verifier" and len(accepted) == 1
        ),
        None,
    )
    aggregate_result = next(
        (
            accepted[0]
            for role, accepted in by_role.items()
            if role == "aggregate-result-falsifier" and len(accepted) == 1
        ),
        None,
    )
    aggregate_covered = {
        row.get("obligation_id")
        for row in (
            aggregate_result.envelope.get("payload", {}).get("coverage", ())
            if aggregate_result is not None
            else ()
        )
        if row.get("disposition") in {"verified", "not-applicable"}
    }
    completion_failures = sum(
        any(
            obligation_id not in aggregate_covered
            for obligation_id in criterion["obligation_ids"]
        )
        for criterion in root.get("completion_criteria", ())
    )
    contract_failures = 0
    if captured["affected_contract_ids"]:
        rows = (
            source_result.envelope.get("payload", {}).get("contracts", ())
            if source_result is not None
            else ()
        )
        if not source_contract_result_valid(
            rows,
            result=source_result,
            dispatch_ledger=dispatch_ledger,
            captured_authority=captured,
            source_index=build_source_index(captured["source_bytes"]),
        ):
            contract_failures = 1
    ui_result = next(
        (
            accepted[0]
            for role, accepted in by_role.items()
            if role == "ui-runtime-verifier" and len(accepted) == 1
        ),
        None,
    )
    root = captured["root_authority"]
    ui_unverified_ids = {
        row["ui_id"]
        for row in root["ui_runtime_results"]
        if row["status"] not in {"verified", "not-applicable"}
    }
    accepted_risk_ids = {
        risk_id
        for acceptance in root["risk_acceptance"]
        for risk_id in [acceptance["residual_risk_id"]]
    }
    accepted_ui_ids = {
        ui_id
        for risk in root["residual_risks"]
        if risk["id"] in accepted_risk_ids
        for ui_id in risk["ui_ids"]
    }
    ui_payload_valid = bool(
        audit_mode
        or not root["ui_mapping"]
        or (
            ui_result is not None
            and authority_digest(
                {"rows": ui_result.envelope["payload"].get("ui_rows", ())}
            )
            == authority_digest({"rows": root["ui_runtime_results"]})
        )
    )
    convergence = root["convergence_state"]
    gate_failures = sum(
        gate["classification"]
        in {"failed", "not-run-prohibited", "not-run-unavailable"}
        for gate in root["gate_results"]
    )
    unresolved = {
        "roles": len(missing_or_duplicate),
        "recovery": len(recovery_ledger.unresolved_units()),
        "restricted": len(dispatch_ledger.unresolved_restricted_obligations()),
        "goal_gaps": len(captured["open_gap_ids"]),
        "watches": open_watches,
        "topology_frontier": topology_frontier,
        "work": len(convergence["open_work_ids"]),
        "feedback": len(convergence["open_feedback_ids"]),
        "gates": gate_failures,
        "contracts": contract_failures,
        "ui": len(ui_unverified_ids - accepted_ui_ids)
        + (0 if ui_payload_valid else 1),
        "reconciliation": len(convergence["open_reconciliation_ids"]),
        "secrets": len(convergence["open_secret_incident_ids"]),
        "peers": len(captured.get("active_peer_ids", ())),
        "completion": completion_failures,
    }
    accepted_coverage: dict[str, dict[str, Any]] = {}
    for role, accepted in by_role.items():
        if len(accepted) != 1:
            continue
        for item in accepted[0].envelope.get("payload", {}).get("coverage", ()):
            report_obligation_id = f"{role}::{item['obligation_id']}"
            candidate = {
                "obligation_id": report_obligation_id,
                "disposition": item["disposition"],
                "evidence": list(item["evidence"]),
            }
            previous = accepted_coverage.get(report_obligation_id)
            if previous is not None and previous != candidate:
                raise RpfConflictError(
                    "accepted roles disagree on atomic coverage evidence"
                )
            accepted_coverage[report_obligation_id] = candidate
    launch_telemetry = dispatch_ledger.launch_telemetry(captured)
    evaluation = _freeze_json({
        "status": (
            "audit-complete"
            if audit_mode and not any(unresolved.values())
            else "limit-reached"
            if any(unresolved.values())
            and limit_exhaustion_evidenced
            else "converged"
            if not audit_mode and not any(unresolved.values())
            else "running"
        ),
        "unresolved": unresolved,
        "accepted_dispatch_ids": tuple(
            accepted[0].envelope["dispatch_id"]
            for role, accepted in sorted(by_role.items())
            if len(accepted) == 1
        ),
        "missing_or_duplicate_roles": missing_or_duplicate,
        "total_cycle": recovery_ledger._limit_cycle,
        "launch_telemetry": launch_telemetry,
        "accepted_coverage": tuple(
            accepted_coverage[obligation_id]
            for obligation_id in sorted(accepted_coverage)
        ),
    })
    if not isinstance(evaluation, Mapping):
        raise RpfContractError("cycle evaluation could not be sealed")
    _register_identity(_CYCLE_EVALUATION_REGISTRY, evaluation)
    _record_fingerprint(
        evaluation,
        captured.get("root_hash"),
        captured.get("capture_digest"),
        authority_digest(evaluation),
    )
    return evaluation


def expected_cycle_report_payload(
    captured_authority: Mapping[str, Any], evaluation: Mapping[str, Any]
) -> Mapping[str, Any]:
    """Build the only accepted report payload from sealed reducer state."""

    if (
        not captured_authority_valid(captured_authority)
        or not isinstance(evaluation, Mapping)
        or not _has_registered_identity(_CYCLE_EVALUATION_REGISTRY, evaluation)
        or not _fingerprint_matches(
            evaluation,
            captured_authority.get("root_hash"),
            captured_authority.get("capture_digest"),
            authority_digest(evaluation),
        )
    ):
        raise RpfContractError("report inputs are not sealed")
    root = captured_authority["root_authority"]
    unresolved = evaluation["unresolved"]
    obligation_kinds: dict[str, str] = {}
    for role in captured_authority["required_role_instances"]:
        for kind, obligation_id in coverage_obligations_for_role(
            captured_authority, role
        ):
            report_obligation_id = f"{role}::{obligation_id}"
            previous = obligation_kinds.setdefault(report_obligation_id, kind)
            if previous != kind:
                raise RpfConflictError("report obligation kind is ambiguous")
    accepted_coverage = {
        row["obligation_id"]: row
        for row in evaluation.get("accepted_coverage", ())
        if isinstance(row, Mapping)
        and isinstance(row.get("obligation_id"), str)
    }
    if len(accepted_coverage) != len(evaluation.get("accepted_coverage", ())):
        raise RpfContractError("evaluation coverage evidence is malformed")
    coverage = []
    for obligation_id, kind in sorted(obligation_kinds.items()):
        accepted = accepted_coverage.get(obligation_id)
        if accepted is None:
            coverage.append({
                "obligation_id": obligation_id,
                "disposition": "unverified",
                "evidence": [f"missing-accepted-dispatch:{obligation_id}"],
            })
        else:
            coverage.append({
                "obligation_id": obligation_id,
                "disposition": accepted["disposition"],
                "evidence": list(accepted["evidence"]),
            })
    gates = root["gate_results"]
    gate_classes = {gate["classification"] for gate in gates}
    prohibited = sorted(
        gate["id"] for gate in gates
        if gate["classification"] == "not-run-prohibited"
    )
    unavailable = sorted(
        gate["id"] for gate in gates
        if gate["classification"] == "not-run-unavailable"
    )
    if gate_classes <= {"passed"}:
        gates_green = "yes"
    elif gate_classes <= {"not-applicable"}:
        gates_green = "not-applicable"
    else:
        gates_green = "no"
    roles = set(captured_authority["required_role_instances"])
    ui_rows = root["ui_runtime_results"]
    ui_status = (
        "not-applicable" if not root["ui_mapping"]
        else "verified"
        if len(ui_rows) == len(root["ui_mapping"])
        and all(row["status"] == "verified" for row in ui_rows)
        else "unverified"
    )
    errors = [
        f"unresolved:{name}:{count}"
        for name, count in sorted(unresolved.items())
        if count
    ]
    payload = {
        "cycle": root["cycle"],
        "total_cycle": evaluation["total_cycle"],
        "run_id": root["run_id"],
        "pointer_doc": ".context/rpf.md",
        "pointer_rev": captured_authority["root_revision"],
        "pointer_hash": captured_authority["root_hash"],
        "active_peers": len(captured_authority.get("active_peer_ids", ())),
        "claim_conflicts": 0,
        "review_agents": evaluation["launch_telemetry"]["review"],
        "verify_agents": evaluation["launch_telemetry"]["verify"],
        "work_agents": evaluation["launch_telemetry"]["work"],
        "runnable_units": sum(evaluation["launch_telemetry"].values()),
        "local_units": evaluation["launch_telemetry"]["local"],
        "peak_parallel": 1
        if sum(
            evaluation["launch_telemetry"][field]
            for field in ("review", "verify", "work")
        )
        else 0,
        "serialization_reasons": [],
        "prefetch": [],
        "new_feedback": unresolved["feedback"],
        "goal_gaps": unresolved["goal_gaps"],
        "pending_tasks": unresolved["work"],
        "material_pointer_changes": 0,
        "commits": [],
        "gate_fixes": [],
        "gates_green": gates_green,
        "deploy": "not-run",
        "source_fence": {
            "base": captured_authority["fence"][0],
            "scope": list(captured_authority["fence"][1]),
            "hash": captured_authority["fence"][2],
        },
        "material_source_changes": 0,
        "independent_review": "clean" if not unresolved["roles"] else "incomplete",
        "result_falsification": (
            "passed" if "aggregate-result-falsifier" in roles and not unresolved["roles"]
            else "incomplete"
        ),
        "regression_falsification": (
            "passed" if "regression-falsifier" in roles and not unresolved["watches"]
            else "not-due" if "regression-falsifier" not in roles
            else "incomplete"
        ),
        "source_contract_status": (
            "not-applicable" if not captured_authority["affected_contract_ids"]
            else "passed" if not unresolved["contracts"] else "incomplete"
        ),
        "coverage_gaps": sum(int(value) for value in unresolved.values()),
        "prohibited_checks": prohibited,
        "unavailable_checks": unavailable,
        "ui_runtime_status": ui_status,
        "restricted_results": unresolved["restricted"],
        "quarantined_items": unresolved["restricted"],
        "secret_exposure": unresolved["secrets"],
        "status": evaluation["status"],
        "errors": errors,
        "summary": (
            "all sealed evidence is complete" if not errors
            else "sealed evidence remains unresolved"
        ),
        "changes": ["no material source change recorded by this reducer"],
        "accepted_dispatch_ids": list(evaluation["accepted_dispatch_ids"]),
        "coverage": coverage,
        "residual_risks": [risk["id"] for risk in root["residual_risks"]],
    }
    if not _report_payload_shape_valid(payload):
        raise RpfContractError("derived report payload is malformed")
    return payload


def cycle_report_result_valid(
    result: ValidatedChildResult,
    *,
    captured_authority: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    dispatch_ledger: DispatchLedger,
) -> bool:
    """Bind a strict machine report to the production reducer output."""

    try:
        if (
            not validated_child_result(result)
            or not captured_authority_valid(captured_authority)
            or not isinstance(evaluation, Mapping)
            or not _has_registered_identity(_CYCLE_EVALUATION_REGISTRY, evaluation)
            or not _fingerprint_matches(
                evaluation,
                captured_authority.get("root_hash"),
                captured_authority.get("capture_digest"),
                authority_digest(evaluation),
            )
            or result.envelope.get("kind")
            != (
                "audit-report"
                if captured_authority.get("mode") == AUDIT_MODE
                else "cycle-report"
            )
            or result.envelope.get("status") != "passed"
            or result.envelope.get("role_instance") != "root-controller"
            or result.envelope.get("cycle")
            != captured_authority["root_authority"]["cycle"]
            or result.envelope.get("run_id")
            != captured_authority["root_authority"]["run_id"]
            or (
                result.envelope["fence"]["base"],
                tuple(result.envelope["fence"]["scope"]),
                result.envelope["fence"]["hash"],
            )
            != captured_authority["fence"]
            or not isinstance(dispatch_ledger, DispatchLedger)
            or dispatch_ledger is not captured_authority.get("dispatch_ledger")
            or not dispatch_ledger.publication_authorized(
                result.envelope.get("dispatch_id"), result
            )
        ):
            return False
        payload = result.envelope["payload"]
        expected = expected_cycle_report_payload(captured_authority, evaluation)
        return authority_digest(payload) == authority_digest(expected)
    except (KeyError, RpfContractError, TypeError, ValueError):
        return False


def carry_open_watches(
    watches: Sequence[Mapping[str, Any]],
    current_fence: tuple[str, tuple[str, ...], str],
    *,
    current_cycle: int,
    current_run_id: str | None = None,
    validated_results: Sequence[ValidatedChildResult] = (),
    dispatch_ledger: DispatchLedger | None = None,
) -> list[dict[str, Any]]:
    if (
        not fence_shape_valid(current_fence)
        or not isinstance(watches, Sequence)
        or type(current_cycle) is not int
        or current_cycle < 1
        or not isinstance(validated_results, Sequence)
    ):
        raise RpfContractError("watch carry input is malformed")
    carried: list[dict[str, Any]] = []
    seen: set[str] = set()
    for watch in watches:
        if not isinstance(watch, Mapping) or set(watch) != {
            "id",
            "rev",
            "status",
            "changed_cycle",
            "fence",
            "obligation",
            "evidence",
            "clearance_result_id",
            "cleared_cycle",
        }:
            raise RpfContractError("watch row keys are not exact")
        watch_id = watch.get("id")
        if not isinstance(watch_id, str) or not watch_id or watch_id in seen:
            raise RpfContractError("watch identity is invalid")
        seen.add(watch_id)
        if (
            type(watch.get("rev")) is not int
            or watch["rev"] < 0
            or type(watch.get("changed_cycle")) is not int
            or watch["changed_cycle"] < 1
            or not isinstance(watch.get("obligation"), str)
            or not watch["obligation"]
            or not _all_strings(watch.get("evidence"))
        ):
            raise RpfContractError("watch revision/cycle is invalid")
        if watch.get("status") not in {"open", "cleared"} or not fence_shape_valid(
            watch.get("fence")
        ):
            raise RpfContractError("watch status/fence is invalid")
        row = dict(watch)
        if row["status"] == "cleared" and row["fence"] != current_fence:
            row["status"] = "open"
            row["rev"] += 1
            row["fence"] = current_fence
            row["clearance_result_id"] = None
            row["cleared_cycle"] = None
            row["evidence"] = [*row["evidence"], "reopened-stale-clearance"]
        elif row["status"] == "open" and row["fence"] != current_fence:
            row["rev"] += 1
            row["fence"] = current_fence
            row["evidence"] = [*row["evidence"], "carried-to-current-fence"]
        if row["status"] == "open":
            if row["clearance_result_id"] is not None or row["cleared_cycle"] is not None:
                raise RpfContractError("open watch cannot carry clearance evidence")
        elif (
            not isinstance(row["clearance_result_id"], str)
            or not row["clearance_result_id"]
            or row["cleared_cycle"] != current_cycle
            or row["cleared_cycle"] <= row["changed_cycle"]
            or f"validated-result:{row['clearance_result_id']}" not in row["evidence"]
        ):
            raise RpfContractError("cleared watch lacks current validated-result evidence")
        elif not any(
            validated_child_result(result)
            and isinstance(dispatch_ledger, DispatchLedger)
            and result.envelope.get("kind") == "regression"
            and result.envelope.get("role_instance") == "regression-falsifier"
            and result.envelope.get("status") == "passed"
            and result.envelope.get("dispatch_id") == row["clearance_result_id"]
            and result.envelope.get("cycle") == current_cycle
            and result.envelope.get("run_id") == current_run_id
            and (
                result.envelope["fence"]["base"],
                tuple(result.envelope["fence"]["scope"]),
                result.envelope["fence"]["hash"],
            )
            == current_fence
            and dispatch_ledger.publication_authorized(
                row["clearance_result_id"], result
            )
            and tuple(
                item.get("obligation_id")
                for item in result.envelope["payload"].get("coverage", ())
            )
            == tuple(
                dispatch_ledger.snapshot(row["clearance_result_id"]).get(
                    "expected_obligation_ids", ()
                )
            )
            and any(
                isinstance(verdict, Mapping)
                and set(verdict)
                == {"watch_id", "status", "counterexample_search", "evidence"}
                and verdict.get("watch_id") == row["id"]
                and verdict.get("status") == "passed"
                and isinstance(verdict.get("counterexample_search"), str)
                and bool(verdict["counterexample_search"])
                and _all_strings(verdict.get("evidence"))
                and f"watch:{row['id']}" in verdict["evidence"]
                for verdict in result.envelope["payload"].get("verdicts", ())
            )
            for result in validated_results
        ):
            raise RpfContractError("cleared watch result is not sealed and exact")
        carried.append(row)
    if any(row["status"] == "open" and row["fence"] != current_fence for row in carried):
        raise RpfContractError("every open watch must bind to the current fence")
    return carried


def merge_revisioned_authority(
    rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Merge only by higher revision; equal-revision differences block."""

    if not isinstance(rows, Sequence):
        raise RpfContractError("authority rows must be a sequence")
    winners: dict[str, dict[str, Any]] = {}
    for item in rows:
        if not isinstance(item, Mapping):
            raise RpfContractError("authority row must be an object")
        row = dict(item)
        if (
            not isinstance(row.get("id"), str)
            or not row["id"]
            or type(row.get("rev")) is not int
            or row["rev"] < 0
        ):
            raise RpfContractError("authority row identity/revision is invalid")
        existing = winners.get(row["id"])
        if existing is None or row["rev"] > existing["rev"]:
            winners[row["id"]] = row
        elif row["rev"] == existing["rev"]:
            if authority_digest(row) != authority_digest(existing):
                raise RpfConflictError("equal-revision authority conflict")
        # A lower revision is historical and cannot replace the winner.
    return [winners[key] for key in sorted(winners)]


def build_source_index(
    source_bytes: Mapping[str, bytes],
) -> Mapping[str, Mapping[str, Any]]:
    scope = _normalized_scope(tuple(source_bytes))
    if scope is None or set(scope) != set(source_bytes):
        raise RpfContractError("source index paths are not canonical")
    index: dict[str, Mapping[str, Any]] = {}
    for path in scope:
        try:
            text = source_bytes[path].decode("utf-8", errors="strict")
            lines = tuple(text.splitlines()) or ("",)
        except UnicodeDecodeError:
            lines = ()
        index[path] = {
            "lines": lines,
            "sha256": hashlib.sha256(source_bytes[path]).hexdigest(),
            "source_bytes": source_bytes[path],
        }
    return index


def source_index_valid(
    source_index: object,
    approved_fence: tuple[str, tuple[str, ...], str],
    repository_root: Path,
) -> bool:
    try:
        if (
            not isinstance(source_index, Mapping)
            or not fence_shape_valid(approved_fence)
            or set(source_index) != set(approved_fence[1])
        ):
            return False
        source_bytes: dict[str, bytes] = {}
        for path, entry in source_index.items():
            if not isinstance(entry, Mapping) or set(entry) != {
                "lines",
                "sha256",
                "source_bytes",
            }:
                return False
            data = entry.get("source_bytes")
            if not isinstance(data, bytes):
                return False
            try:
                text = data.decode("utf-8", errors="strict")
                expected_lines = tuple(text.splitlines()) or ("",)
            except UnicodeDecodeError:
                expected_lines = ()
            if (
                entry.get("sha256") != hashlib.sha256(data).hexdigest()
                or entry.get("lines") != expected_lines
            ):
                return False
            source_bytes[path] = data
        return canonical_fence(
            approved_fence[0],
            approved_fence[1],
            approved_fence[2],
            source_bytes,
            repository_root=repository_root,
            allow_pre_contract=approved_fence[0] == "PRE-CONTRACT",
        ) == approved_fence
    except (UnicodeDecodeError, RpfContractError, TypeError, ValueError):
        return False


def source_ref_valid(
    ref: object,
    source_index: Mapping[str, Mapping[str, Any]],
    approved_fence: tuple[str, tuple[str, ...], str],
    repository_root: Path,
) -> bool:
    try:
        if not source_index_valid(source_index, approved_fence, repository_root):
            return False
        if not isinstance(ref, Mapping) or set(ref) != {"path", "line", "symbol"}:
            return False
        path, line, symbol = ref.get("path"), ref.get("line"), ref.get("symbol")
        if (
            not isinstance(path, str)
            or path not in source_index
            or type(line) is not int
            or line < 1
            or not isinstance(symbol, str)
            or not symbol
        ):
            return False
        lines = source_index[path].get("lines")
        return bool(
            isinstance(lines, tuple)
            and line <= len(lines)
            and re.search(
                rf"(?<![A-Za-z0-9_]){re.escape(symbol)}(?![A-Za-z0-9_])",
                lines[line - 1],
            )
        )
    except (AttributeError, IndexError, KeyError, TypeError):
        return False


def _claim_valid(
    value: object,
    source_index: Mapping[str, Mapping[str, Any]],
    approved_fence: tuple[str, tuple[str, ...], str],
    repository_root: Path,
) -> bool:
    return bool(
        isinstance(value, Mapping)
        and set(value) == {"claim", "refs"}
        and isinstance(value.get("claim"), str)
        and value.get("claim")
        and isinstance(value.get("refs"), list)
        and value.get("refs")
        and all(
            source_ref_valid(ref, source_index, approved_fence, repository_root)
            for ref in value["refs"]
        )
    )


def source_contract_valid(
    row: object,
    *,
    captured_authority: Mapping[str, Any],
    source_index: Mapping[str, Mapping[str, Any]],
    approved_fence: tuple[str, tuple[str, ...], str],
    repository_root: Path,
) -> bool:
    fields = {
        "id",
        "contract",
        "producer",
        "consumers",
        "inputs",
        "outputs",
        "invariants",
        "success",
        "error",
        "variants",
        "counterexample",
        "evidence",
        "residual_risk",
        "status",
        "rev",
        "cycle",
        "run_id",
        "dispatch_id",
        "fence",
        "coverage_ids",
        "provenance",
    }
    if (
        not isinstance(row, Mapping)
        or set(row) != fields
        or not captured_authority_valid(captured_authority)
        or not source_index_valid(source_index, approved_fence, repository_root)
    ):
        return False
    contract_id = row.get("id")
    contracts = captured_authority["root_authority"]["contracts"]
    if (
        not isinstance(contract_id, str)
        or contract_id not in captured_authority["affected_contract_ids"]
        or row.get("contract") != contracts.get(contract_id, {}).get("name")
        or row.get("cycle") != captured_authority["root_authority"]["cycle"]
        or row.get("run_id") != captured_authority["root_authority"]["run_id"]
        or row.get("fence") != captured_authority["fence"]
    ):
        return False
    if (
        row.get("status") not in {"verified", "falsified"}
        or type(row.get("rev")) is not int
        or row["rev"] < 0
        or type(row.get("cycle")) is not int
        or row["cycle"] < (0 if captured_authority.get("mode") == AUDIT_MODE else 1)
        or not isinstance(row.get("run_id"), str)
        or not row["run_id"]
        or not isinstance(row.get("dispatch_id"), str)
        or not row["dispatch_id"]
        or row.get("fence") != approved_fence
        or not _all_strings(row.get("coverage_ids"))
        or len(row["coverage_ids"]) != len(set(row["coverage_ids"]))
    ):
        return False
    if not source_ref_valid(
        row.get("producer"), source_index, approved_fence, repository_root
    ):
        return False
    consumers = row.get("consumers")
    if (
        not isinstance(consumers, list)
        or not consumers
        or not all(
            source_ref_valid(ref, source_index, approved_fence, repository_root)
            for ref in consumers
        )
        or len({authority_digest(ref) for ref in consumers}) != len(consumers)
    ):
        return False
    typed_refs: dict[str, set[str]] = {}
    for field in ("inputs", "outputs"):
        values = row.get(field)
        if (
            not isinstance(values, list)
            or not values
            or any(
                not isinstance(item, Mapping)
                or set(item) != {"name", "type", "source_ref"}
                or not isinstance(item.get("name"), str)
                or not item["name"]
                or not isinstance(item.get("type"), str)
                or not item["type"]
                or not source_ref_valid(
                    item.get("source_ref"),
                    source_index,
                    approved_fence,
                    repository_root,
                )
                for item in values
            )
        ):
            return False
        identities = {
            (
                item["name"],
                item["type"],
                authority_digest(item["source_ref"]),
            )
            for item in values
        }
        if len(identities) != len(values):
            return False
        typed_refs[field] = {
            authority_digest(item["source_ref"]) for item in values
        }
    invariants = row.get("invariants")
    if not isinstance(invariants, list) or not invariants or not all(
        _claim_valid(item, source_index, approved_fence, repository_root)
        for item in invariants
    ):
        return False
    for field in ("success", "error", "variants", "counterexample"):
        if not _claim_valid(
            row.get(field), source_index, approved_fence, repository_root
        ):
            return False
    semantic_claims = [*invariants] + [
        row[field] for field in ("success", "error", "variants", "counterexample")
    ]
    if len({authority_digest(claim) for claim in semantic_claims}) != len(
        semantic_claims
    ):
        return False
    evidence = row.get("evidence")
    provenance = row.get("provenance")
    producer_digest = authority_digest(row["producer"])
    consumer_digests = {authority_digest(ref) for ref in consumers}
    semantic_ref_sets = {
        field: {authority_digest(ref) for ref in row[field]["refs"]}
        for field in ("success", "error", "variants", "counterexample")
    }
    return bool(
        isinstance(evidence, list)
        and evidence
        and all(
            source_ref_valid(ref, source_index, approved_fence, repository_root)
            for ref in evidence
        )
        and len({authority_digest(ref) for ref in evidence}) == len(evidence)
        and isinstance(row.get("residual_risk"), str)
        and row.get("residual_risk")
        and producer_digest not in consumer_digests
        and typed_refs["inputs"] <= consumer_digests
        and producer_digest in typed_refs["outputs"]
        and typed_refs["outputs"] <= {producer_digest}
        and producer_digest in semantic_ref_sets["success"]
        and all(
            semantic_ref_sets[field] & consumer_digests
            for field in ("error", "variants", "counterexample")
        )
        and isinstance(provenance, Mapping)
        and set(provenance) == {"producer_ref", "consumer_refs", "evidence_refs"}
        and provenance.get("producer_ref") == row["producer"]
        and provenance.get("consumer_refs") == consumers
        and provenance.get("evidence_refs") == evidence
    )


def source_contract_result_valid(
    rows: Sequence[Mapping[str, Any]],
    *,
    result: ValidatedChildResult,
    dispatch_ledger: DispatchLedger,
    captured_authority: Mapping[str, Any],
    source_index: Mapping[str, Mapping[str, Any]],
) -> bool:
    """Reduce the complete source-contract set against sealed cycle authority."""

    try:
        if (
            not validated_child_result(result)
            or not captured_authority_valid(captured_authority)
            or result.envelope.get("kind") != "source-contract"
            or result.envelope.get("role_instance") != "source-contract-verifier"
            or not dispatch_ledger.publication_authorized(
                result.envelope.get("dispatch_id"), result
            )
        ):
            return False
        expected_contract_ids = tuple(captured_authority["affected_contract_ids"])
        if tuple(row.get("id") for row in rows) != expected_contract_ids:
            return False
        repository_root = Path(captured_authority["repository_root"])
        if not all(
            source_contract_valid(
                row,
                captured_authority=captured_authority,
                source_index=source_index,
                approved_fence=captured_authority["fence"],
                repository_root=repository_root,
            )
            for row in rows
        ):
            return False
        if authority_digest(
            {"rows": result.envelope["payload"].get("contracts", ())}
        ) != authority_digest({"rows": rows}):
            return False
        if any(
            row.get("dispatch_id") != result.envelope.get("dispatch_id")
            for row in rows
        ):
            return False
        expected_status = (
            "failed" if any(row.get("status") == "falsified" for row in rows) else "passed"
        )
        if result.envelope.get("status") != expected_status:
            return False
        returned = tuple(
            item.get("obligation_id")
            for item in result.envelope["payload"].get("coverage", ())
        )
        expected_coverage = tuple(
            obligation_id
            for _, obligation_id in coverage_obligations_for_role(
                captured_authority, "source-contract-verifier"
            )
        )
        return returned == expected_coverage
    except (KeyError, RpfContractError, TypeError, ValueError):
        return False


def topology_coverage_valid(
    rows: object,
    captured_topology: Mapping[str, Mapping[str, Any]],
    source_index: Mapping[str, Mapping[str, Any]],
    approved_fence: tuple[str, tuple[str, ...], str],
    repository_root: Path,
) -> bool:
    fields = {
        "family",
        "applicable",
        "reason",
        "roots",
        "node_count",
        "edge_count",
        "budget",
        "frontier",
        "refs",
    }
    if (
        not isinstance(rows, list)
        or not isinstance(captured_topology, Mapping)
        or not source_index_valid(source_index, approved_fence, repository_root)
        or set(captured_topology) != set(GAME_FAMILIES)
        or any(not isinstance(row, Mapping) or set(row) != fields for row in rows)
    ):
        return False
    by_family = {row.get("family"): row for row in rows}
    if len(by_family) != len(rows) or set(by_family) != set(GAME_FAMILIES):
        return False
    for family, authoritative in captured_topology.items():
        row = by_family[family]
        if not _topology_authority_shape_valid(authoritative):
            return False
        if (
            type(authoritative.get("applicable")) is not bool
            or row.get("applicable") is not authoritative["applicable"]
            or row.get("roots") != authoritative.get("roots")
            or row.get("reason") != authoritative.get("reason")
            or row.get("node_count") != authoritative.get("node_count")
            or row.get("edge_count") != authoritative.get("edge_count")
            or row.get("budget") != authoritative.get("budget")
            or row.get("frontier") != authoritative.get("frontier")
            or row.get("refs") != authoritative.get("refs")
            or not all(
                source_ref_valid(ref, source_index, approved_fence, repository_root)
                for ref in row["refs"]
            )
        ):
            return False
        if authoritative["applicable"]:
            if (
                not row["roots"]
                or type(row.get("node_count")) is not int
                or row["node_count"] < len(row["roots"])
                or type(row.get("edge_count")) is not int
                or row["edge_count"] < 0
                or type(row.get("budget")) is not int
                or row["budget"] < row["node_count"] + row["edge_count"]
                or row.get("frontier") != []
            ):
                return False
        elif row["roots"]:
            return False
    return True


def _cli(argv: Sequence[str] | None = None) -> int:
    """Expose only phase-zero operations whose output is safe metadata."""

    parser = argparse.ArgumentParser(
        description="RPF phase-zero metadata helpers; never emits inspected bytes"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    classify = subparsers.add_parser("classify", help="classify exact file paths")
    classify.add_argument("paths", nargs="+")
    probe = subparsers.add_parser(
        "probe-exchange", help="probe native atomic exchange in an existing directory"
    )
    probe.add_argument("directory")
    arguments = parser.parse_args(argv)

    if arguments.command == "classify":
        rows = [
            {
                "path": result.path,
                "disposition": result.disposition,
                "reason": result.reason,
                "sha256": result.sha256,
                "incident_id": result.incident_id,
            }
            for path in arguments.paths
            for result in [
                classify_path(Path(path), repository_root=Path.cwd())
            ]
        ]
        print(json.dumps(rows, ensure_ascii=False, sort_keys=True))
        return 0 if all(row["disposition"] == "approved" for row in rows) else 2
    directory = Path(arguments.directory).resolve(strict=True)
    result = {
        "directory": os.fspath(directory),
        "atomic_exchange_available": atomic_exchange_available(),
        "atomic_exchange_works": atomic_exchange_works(directory),
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["atomic_exchange_works"] else 2


if __name__ == "__main__":
    raise SystemExit(_cli())
