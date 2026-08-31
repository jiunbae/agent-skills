import dataclasses
import copy
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import rpf_runtime as runtime  # noqa: E402


BASE = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
).strip()
SOURCE_PATH = "agents/rpf/tests/fixtures/source_fixture.py"
CHANGED_SOURCE_PATH = "agents/rpf/tests/fixtures/source_changed.py"
UI_SOURCE_PATH = "agents/rpf/tests/fixtures/ui_fixture.tsx"
GAME_PROJECT_PATH = "agents/rpf/tests/fixtures/project.godot"
GAME_SCENE_PATH = "agents/rpf/tests/fixtures/main.tscn"


class HostAdapter:
    def __init__(self, callback: object) -> None:
        self.callback = callback

    def invoke(self, value: object) -> object:
        return self.callback(value)  # type: ignore[operator]


def source_fixture() -> tuple[dict[str, bytes], tuple[str, tuple[str, ...], str]]:
    source = {SOURCE_PATH: (REPO_ROOT / SOURCE_PATH).read_bytes()}
    digest = runtime.scope_digest((SOURCE_PATH,), source)
    return source, runtime.canonical_fence(
        BASE, [SOURCE_PATH], digest, source, repository_root=REPO_ROOT
    )


def envelope(
    fence: tuple[str, tuple[str, ...], str],
    *,
    kind: str = "review",
    status: str = "passed",
    dispatch_id: str = "dispatch-1",
) -> dict[str, object]:
    payloads: dict[str, dict[str, object]] = {
        "review": {
            "findings": [],
            "coverage": [
                {
                    "obligation_id": "ROLE-1",
                    "disposition": "verified",
                    "evidence": ["source-ref"],
                }
            ],
            "residual_risks": [],
        },
        "ui-runtime": {
            "ui_rows": [],
            "coverage": [
                {
                    "obligation_id": "UI-RUNTIME",
                    "disposition": "verified",
                    "evidence": ["runtime-record"],
                }
            ],
            "residual_risks": [],
        },
        "restricted": {"incident_id": "INC-" + "1" * 24, "obligation_ids": ["ROLE-1"]},
        "incomplete": {"reason": "transport", "obligation_ids": ["ROLE-1"]},
        "needs-scope-expansion": {
            "paths": [SOURCE_PATH],
            "reason": "required consumer is outside the captured subset",
        },
    }
    return {
        "protocol_version": runtime.PROTOCOL_VERSION,
        "kind": kind,
        "status": status,
        "role_instance": "conclusion-blind-persona:security",
        "cycle": 7,
        "run_id": "run-7",
        "dispatch_id": dispatch_id,
        "fence": {"base": fence[0], "scope": list(fence[1]), "hash": fence[2]},
        "payload": payloads[kind],
    }


def root_authority(
    fence: tuple[str, tuple[str, ...], str], source: dict[str, bytes]
) -> dict[str, object]:
    primary_path = sorted(source)[0]
    inventory = runtime.derive_source_contract_inventory(
        source, base=fence[0], repository_root=REPO_ROOT
    )
    prohibited_commands = {
        item["command"] for item in inventory["prohibitions"].values()
    }
    gates = [
        {
            "id": item["id"],
            "classification": (
                "not-run-prohibited"
                if item["command"] in prohibited_commands
                else "not-run-unavailable"
            ),
            "affected_contract_ids": item["affected_contract_ids"],
            "fence": fence,
        }
        for _, item in sorted(inventory["gates"].items())
    ] or [{
        "id": "GATE-NONE",
        "classification": "not-applicable",
        "affected_contract_ids": [],
        "fence": fence,
    }]
    prohibitions = [
        {
            "id": item["id"],
            "command": item["command"],
            "source_ref": {
                "path": item["path"],
                "line": item["line"],
                "symbol": item["symbol"],
                "command_sha256": hashlib.sha256(
                    item["command"].encode()
                ).hexdigest(),
            },
            "affected_contract_ids": item["affected_contract_ids"],
            "fence": fence,
        }
        for _, item in sorted(inventory["prohibitions"].items())
    ]
    personas = ["security", "testing"]
    if runtime.derive_ui_mapping(source):
        personas.append("frontend")
    affected_contracts = {
        contract_id
        for contract_id, contract in inventory["contracts"].items()
        if contract["changed"]
    } | {
        contract_id
        for item in inventory["prohibitions"].values()
        for contract_id in item["affected_contract_ids"]
    } | {
        contract_id
        for gate in gates
        if gate["classification"] in {"not-run-prohibited", "not-run-unavailable"}
        for contract_id in gate["affected_contract_ids"]
    }
    roles = (
        "pointer-alignment",
        "plan-doc-consistency",
        "aggregate-result-falsifier",
        "conclusion-blind-persona:security",
        "conclusion-blind-persona:testing",
        *(("conclusion-blind-persona:frontend",) if "frontend" in personas else ()),
        "regression-falsifier",
        *(("source-contract-verifier",) if affected_contracts else ()),
    )
    return {
        "pointer_revision": 24,
        "projection_sha256": "0" * 64,
        "cycle": 7,
        "run_id": "run-7",
        "fence": fence,
        "contracts": inventory["contracts"],
        "gate_results": gates,
        "aggregate_claims": {
            f"claim:{index}": {
                "role_instance": role,
                "claim": f"claim for {role}",
                "refs": [{"path": primary_path, "line": 1, "symbol": "producer"}],
            }
            for index, role in enumerate(roles, 1)
        },
        "selected_personas": personas,
        "persona_evidence": {
            persona: {
                "source": "bundled",
                "applicable": True,
                "reason": "captured scope requires this independent lens",
                "refs": [{"path": primary_path, "line": 1, "symbol": "producer"}],
            }
            for persona in personas
        },
        "repository_roles": [],
        "topology": runtime.derive_game_topology(source),
        "regression_watches": [
            {
                "id": "RW-1",
                "rev": 1,
                "status": "open",
                "changed_cycle": 6,
                "fence": fence,
                "obligation": "save contract",
                "evidence": [f"{primary_path}:1"],
                "clearance_result_id": None,
                "cleared_cycle": None,
            }
        ],
        "ui_mapping": {},
        "no_ui_detection": {
            "id": "UI-NONE-1",
            "status": "not-applicable",
            "kind": "no-ui-detection",
            "evidence": "inventory:no-ui",
            "cycle": 7,
            "run": "run-7",
            "dispatch": "dispatch-no-ui",
            "fence": fence,
        },
        "runtime_records": {},
        "runtime_receipts": {},
        "ui_runtime_results": [],
        "backup_records": {},
        "backup_comparisons": {},
        "incident_coverage": runtime.derive_incident_coverage(source),
        "recovery_state": {
            "format": "rpf-adaptive-recovery-v1",
            "total_cycles": 128,
            "start_cycle": 1,
            "snapshot_sha256": hashlib.sha256(
                runtime.AdaptiveRecoveryLedger(total_cycles=128).snapshot()
            ).hexdigest(),
            "unresolved_units": [],
        },
        "convergence_state": {
            "open_work_ids": [],
            "open_feedback_ids": [],
            "open_reconciliation_ids": [],
            "open_secret_incident_ids": [],
        },
        "open_gap_ids": [],
        "test_prohibitions": prohibitions,
        "residual_risks": [],
        "risk_acceptance": [],
        "completion_criteria": [{
            "id": "CC-1",
            "text": "all required evidence is current",
            "obligation_ids": [primary_path],
        }],
    }


def pointer_document(
    authority: dict[str, object],
    *,
    goal_rows: bytes = b"",
    work_rows: bytes = b"",
    reconciliation_rows: bytes = b"",
    secret_rows: bytes = b"",
    feedback_rows: bytes = b"",
    active_run_rows: bytes = b"",
) -> bytes:
    projection = (
        b"\n\n## Active runs\n\n| Run ID | Tool | Cycle | Phase |\n|---|---|---:|---|\n"
        + active_run_rows
        + b"\n## Reconciliation queue\n\n| ID | Status | Rev | Scope |\n|---|---|---:|---|\n"
        + reconciliation_rows
        + b"\n## Goal gaps\n\n| ID | Status | Rev | Gap |\n|---|---|---:|---|\n"
        + goal_rows
        + b"\n## Work queue\n\n| ID | Status | Rev | Task |\n|---|---|---:|---|\n"
        + work_rows
        + b"\n## Secret exposure incidents\n\n| ID | Status | Rev | Source |\n|---|---|---:|---|\n"
        + secret_rows
        + b"\n## Feedback\n\n| ID | Source | Cycle | Feedback | Disposition |\n|---|---|---:|---|---|\n"
        + feedback_rows
    )
    rendered = dict(authority)
    rendered["projection_sha256"] = hashlib.sha256(projection).hexdigest()
    return runtime.serialize_root_authority(rendered) + projection


def grounded_evidence(
    captured: object, role: str, obligation_id: str
) -> list[str]:
    authority = captured  # type: ignore[assignment]
    pair = next(
        item
        for item in runtime.coverage_obligations_for_role(authority, role)
        if item[1] == obligation_id
    )
    kind = pair[0]
    root = authority["root_authority"]
    if kind == "source":
        data = authority["source_bytes"][obligation_id]
        return [f"source:{obligation_id}:{hashlib.sha256(data).hexdigest()}"]
    if kind == "topology":
        refs = root["topology"][obligation_id.removeprefix("topology:")]["refs"]
    elif kind == "incident":
        refs = root["incident_coverage"][
            obligation_id.removeprefix("incident:")
        ]["refs"]
    elif kind == "probe":
        refs = root["aggregate_claims"][obligation_id]["refs"]
    elif kind == "regression":
        return [f"watch:{obligation_id}"]
    elif kind == "audit":
        return [obligation_id]
    else:
        return [f"{kind}:{obligation_id}"]
    return [
        f"source-ref:{ref['path']}:{ref['line']}:{ref['symbol']}"
        for ref in refs
    ]


class RpfRuntimeContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source, self.fence = source_fixture()
        self.limits = runtime.DispatchLimits(30, 64 * 1024, 1024 * 1024)
        self.audit = runtime.resolve_execution_mode(mutation_authorized=False)
        self.full = runtime.resolve_execution_mode(mutation_authorized=True)
        self.cancellation = runtime.create_os_cancellation_provider()
        self.restart_key = runtime.create_restart_authentication_key()
        self.host_processes: list[subprocess.Popen[bytes]] = []

    def tearDown(self) -> None:
        for process in self.host_processes:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=2)
            if process.stdout is not None and not process.stdout.closed:
                process.stdout.close()

    def attach_host(self, ledger: runtime.DispatchLedger, dispatch_id: str) -> None:
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                (
                    "import signal,subprocess,sys,time;"
                    "signal.signal(signal.SIGCHLD,signal.SIG_IGN);"
                    "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
                    "print(child.pid,flush=True);time.sleep(60)"
                ),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        assert process.stdout is not None
        child_pid = int(process.stdout.readline().decode("ascii").strip())
        self.host_processes.append(process)
        ledger.attach_host(
            dispatch_id,
            pid=process.pid,
            child_pid=child_pid,
            stream=process.stdout,
        )

    def decode(self, value: dict[str, object]) -> runtime.ValidatedChildResult:
        return runtime.decode_child_result(
            json.dumps(value).encode(),
            finish_reason="stop",
            limits=self.limits,
            controller_canary="CONTROLLER-CANARY",
        )

    def record_recovery_failure(
        self,
        recovery: runtime.AdaptiveRecoveryLedger,
        ledger: runtime.DispatchLedger,
        unit_id: str,
        obligation_ids: list[str],
        failure_kind: str,
        captured: object,
        *,
        cycle: int = 7,
    ) -> None:
        dispatch_id = f"failed-{unit_id}"
        ledger.start(
            dispatch_id,
            self.limits,
            now=0,
            role_instance="conclusion-blind-persona:security",
            cycle=cycle,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=obligation_ids,
        )
        if failure_kind == "timed-out":
            self.attach_host(ledger, dispatch_id)
            ledger.expire(dispatch_id, now=31)
        elif failure_kind == "invalid-coverage":
            rejected = envelope(
                self.fence,
                dispatch_id=dispatch_id,
            )
            rejected["cycle"] = cycle
            rejected["payload"]["coverage"] = [{
                "obligation_id": "deliberately-wrong-obligation",
                "disposition": "verified",
                "evidence": ["deliberately-wrong-evidence"],
            }]
            with self.assertRaises(runtime.RpfContractError):
                ledger.accept(dispatch_id, self.decode(rejected), now=1)
        else:
            rejected = envelope(
                self.fence,
                kind="incomplete",
                status="incomplete",
                dispatch_id=dispatch_id,
            )
            rejected["cycle"] = cycle
            rejected["payload"]["obligation_ids"] = obligation_ids
            rejected["payload"]["reason"] = failure_kind
            ledger.accept(dispatch_id, self.decode(rejected), now=1)
        recovery.record_failure(
            unit_id,
            obligation_ids=obligation_ids,
            failure_kind=failure_kind,
            cycle=cycle,
            failed_dispatch_id=dispatch_id,
            dispatch_ledger=ledger,
            captured_authority=captured,
        )

    def test_a_host_capability_handshake_and_conflict_preserving_publication(self) -> None:
        host_cancellation = runtime.create_os_cancellation_provider()
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            root = Path(directory)
            pointer = root / "pointer.md"

            def document(revision: int, *, run_id: str = "run-7") -> bytes:
                authority = root_authority(self.fence, self.source)
                authority["pointer_revision"] = revision
                authority["run_id"] = run_id
                authority["no_ui_detection"]["run"] = run_id
                return pointer_document(authority)

            pointer.write_bytes(document(24))
            publication_contract = {
                "approved_fence": self.fence,
                "source_bytes": self.source,
                "repository_root": REPO_ROOT,
            }
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=False
            ):
                audit = runtime.capability_handshake(
                    authority=self.audit,
                    protected_paths=[pointer],
                    pointer_parents=[],
                    dispatch_limits=self.limits,
                    cancellation_provider=host_cancellation,
                    repository_root=REPO_ROOT,
                )
            self.assertTrue(audit["protected_classifier"])
            self.assertEqual("disabled-audit", audit["pointer_publication"])
            self.assertEqual(runtime.AUDIT_MODE, audit["mode"])
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=False
            ), self.assertRaises(runtime.RpfContractError):
                runtime.capability_handshake(
                    authority=self.full,
                    protected_paths=[pointer],
                    pointer_parents=[root],
                    dispatch_limits=self.limits,
                    cancellation_provider=host_cancellation,
                    repository_root=REPO_ROOT,
                )
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=True
            ), mock.patch.object(
                runtime, "atomic_exchange_works", return_value=False
            ), self.assertRaises(runtime.RpfContractError):
                runtime.capability_handshake(
                    authority=self.full,
                    protected_paths=[pointer],
                    pointer_parents=[root],
                    dispatch_limits=self.limits,
                    cancellation_provider=host_cancellation,
                    repository_root=REPO_ROOT,
                )
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=True
            ), mock.patch.object(
                runtime, "atomic_exchange_works", return_value=True
            ):
                full = runtime.capability_handshake(
                    authority=self.full,
                    protected_paths=[pointer],
                    pointer_parents=[root],
                    dispatch_limits=self.limits,
                    cancellation_provider=host_cancellation,
                    repository_root=REPO_ROOT,
                )
            self.assertEqual("atomic-exchange", full["pointer_publication"])
            self.assertEqual("conflict-preserving", full["pointer_assurance"])

            expected = runtime.observe_snapshot(pointer)
            candidate = document(25)
            published = runtime.publish_if_exact(
                pointer,
                expected,
                candidate,
                authority=self.full,
                run_id="run-7",
                **publication_contract,
            )
            self.assertEqual("published", published.status)
            self.assertEqual(candidate, pointer.read_bytes())
            self.assertTrue(
                any(
                    "published-displaced-live-" in path
                    for path in published.recovery_paths
                )
            )

            stale = runtime.publish_if_exact(
                pointer,
                expected,
                document(26),
                authority=self.full,
                run_id="run-7",
                **publication_contract,
            )
            self.assertEqual("reconcile-required", stale.status)
            self.assertEqual(candidate, pointer.read_bytes())
            self.assertGreaterEqual(len(stale.recovery_paths), 4)

            expected = runtime.observe_snapshot(pointer)
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=False
            ):
                unavailable = runtime.publish_if_exact(
                    pointer,
                    expected,
                    document(26),
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
            self.assertEqual("deferred-provider-unavailable", unavailable.status)
            self.assertEqual(candidate, pointer.read_bytes())

            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=True
            ), mock.patch.object(
                runtime, "_directory_path_matches_fd", return_value=False
            ):
                parent_changed = runtime.publish_if_exact(
                    pointer,
                    runtime.observe_snapshot(pointer),
                    document(26),
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
            self.assertEqual("reconcile-required", parent_changed.status)
            self.assertEqual(candidate, pointer.read_bytes())

            poison_data = b"pre-created attacker bytes"
            digest = hashlib.sha256(candidate).hexdigest()
            poison = runtime._recovery_directory(
                pointer, REPO_ROOT, "run-7"
            ) / f"base-{digest}.bin"
            poison.write_bytes(poison_data)
            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=False
            ):
                poisoned = runtime.publish_if_exact(
                    pointer,
                    runtime.observe_snapshot(pointer),
                    document(26),
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
            self.assertEqual(poison_data, poison.read_bytes())
            self.assertTrue(
                any(
                    Path(path).read_bytes() == candidate
                    for path in poisoned.recovery_paths
                    if path.endswith(".bin")
                )
            )

            expected = runtime.observe_snapshot(pointer)
            native_exchange = runtime._atomic_exchange_at
            exchange_calls = 0
            peer = document(26, run_id="peer-run")
            attempted = document(27)

            def raced_exchange(directory_fd: int, left: str, right: str) -> None:
                nonlocal exchange_calls
                exchange_calls += 1
                if exchange_calls == 1:
                    pointer.write_bytes(peer)
                native_exchange(directory_fd, left, right)

            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=True
            ), mock.patch.object(runtime, "_atomic_exchange_at", side_effect=raced_exchange):
                raced = runtime.publish_if_exact(
                    pointer,
                    expected,
                    attempted,
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
            self.assertEqual("reconcile-required", raced.status)
            self.assertEqual(peer, pointer.read_bytes())
            preserved = {
                Path(path).read_bytes()
                for path in raced.recovery_paths
                if path.endswith(".bin")
            }
            self.assertTrue({candidate, peer, attempted}.issubset(preserved))

            expected = runtime.observe_snapshot(pointer)
            rollback_peer = document(27, run_id="rollback-peer")
            rollback_candidate = document(27)
            rollback_calls = 0

            def rollback_fails(directory_fd: int, left: str, right: str) -> None:
                nonlocal rollback_calls
                rollback_calls += 1
                if rollback_calls == 1:
                    pointer.write_bytes(rollback_peer)
                    native_exchange(directory_fd, left, right)
                    return
                raise OSError("rollback unavailable")

            with mock.patch.object(
                runtime, "atomic_exchange_available", return_value=True
            ), mock.patch.object(runtime, "_atomic_exchange_at", side_effect=rollback_fails):
                rollback = runtime.publish_if_exact(
                    pointer,
                    expected,
                    rollback_candidate,
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
            self.assertEqual("reconcile-required", rollback.status)
            self.assertEqual(rollback_candidate, pointer.read_bytes())
            self.assertTrue(
                any(
                    Path(path).read_bytes() == rollback_peer
                    for path in rollback.recovery_paths
                    if path.endswith(".bin")
                )
            )

            expected = runtime.observe_snapshot(pointer)
            held = pointer.open("r+b")
            try:
                final_candidate = document(28)
                final = runtime.publish_if_exact(
                    pointer,
                    expected,
                    final_candidate,
                    authority=self.full,
                    run_id="run-7",
                    **publication_contract,
                )
                held.seek(0, 2)
                held.write(b"\npeer-after-exchange")
                held.flush()
            finally:
                held.close()
            self.assertEqual("published", final.status)
            self.assertEqual(final_candidate, pointer.read_bytes())
            self.assertTrue(
                any(
                    Path(path).read_bytes().endswith(b"peer-after-exchange")
                    for path in final.recovery_paths
                )
            )

            publication_parent = root / "publication-race"
            moved_publication_parent = root / "publication-race-moved"
            publication_parent.mkdir()
            raced_pointer = publication_parent / "pointer.md"
            raced_pointer.write_bytes(document(24))
            native_retain = runtime._retain_live_displaced_at
            parent_swapped = False

            def retain_then_swap(*args: object, **kwargs: object) -> Path:
                nonlocal parent_swapped
                retained = native_retain(*args, **kwargs)
                if not parent_swapped:
                    parent_swapped = True
                    publication_parent.rename(moved_publication_parent)
                    publication_parent.mkdir()
                return retained

            try:
                with mock.patch.object(
                    runtime,
                    "_retain_live_displaced_at",
                    side_effect=retain_then_swap,
                ):
                    final_race = runtime.publish_if_exact(
                        raced_pointer,
                        runtime.observe_snapshot(raced_pointer),
                        document(25),
                        authority=self.full,
                        run_id="run-7",
                        **publication_contract,
                    )
                self.assertEqual("reconcile-required", final_race.status)
                self.assertFalse(raced_pointer.exists())
                self.assertTrue(all(Path(path).is_file() for path in final_race.recovery_paths))
            finally:
                publication_parent.rmdir()
                moved_publication_parent.rename(publication_parent)

            secret_candidate = b"PASSWORD=unquoted-secret-material"
            restricted = runtime.publish_if_exact(
                pointer,
                runtime.observe_snapshot(pointer),
                secret_candidate,
                authority=self.full,
                run_id="run-7",
                **publication_contract,
            )
            self.assertEqual("blocked-restricted", restricted.status)
            secret_digest = hashlib.sha256(secret_candidate).hexdigest()
            for recovery_path in restricted.recovery_paths:
                self.assertNotIn(secret_digest, recovery_path)
                self.assertNotIn(secret_candidate, Path(recovery_path).read_bytes())

            absent = root / "new-pointer.md"
            self.assertEqual(
                "created",
                runtime.create_if_absent(
                    absent,
                    document(1),
                    authority=self.full,
                    **publication_contract,
                ),
            )
            self.assertEqual(
                "exists",
                runtime.create_if_absent(
                    absent,
                    document(2),
                    authority=self.full,
                    **publication_contract,
                ),
            )
            with self.assertRaises(PermissionError):
                runtime.create_if_absent(
                    root / "audit-pointer.md",
                    document(1),
                    authority=self.audit,
                    **publication_contract,
                )

            race_parent = root / "create-race"
            moved_parent = root / "create-race-moved"
            race_parent.mkdir()
            native_write = runtime._write_private_at

            def swap_parent_after_write(
                directory_fd: int,
                name: str,
                data: bytes,
                *,
                exclusive: bool = True,
            ) -> None:
                native_write(directory_fd, name, data, exclusive=exclusive)
                if name == "raced.md":
                    race_parent.rename(moved_parent)
                    race_parent.mkdir()

            try:
                with mock.patch.object(
                    runtime, "_write_private_at", side_effect=swap_parent_after_write
                ), self.assertRaises(runtime.RpfConflictError):
                    runtime.create_if_absent(
                        race_parent / "raced.md",
                        document(1),
                        authority=self.full,
                        **publication_contract,
                    )
                self.assertFalse((race_parent / "raced.md").exists())
                self.assertFalse((moved_parent / "raced.md").exists())
            finally:
                race_parent.rmdir()
                moved_parent.rename(race_parent)

            self.assertEqual(
                "auto", runtime.reconciliation_mode(disjoint_or_append_only=True)
            )
            self.assertEqual(
                "user",
                runtime.reconciliation_mode(
                    disjoint_or_append_only=True, authored_intent=True
                ),
            )
        self.assertEqual(
            runtime.AUDIT_MODE,
            runtime.resolve_execution_mode(mutation_authorized=False).mode,
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.resolve_execution_mode(
                mutation_authorized=False, explicit_mode=runtime.FULL_MODE
            )
        for sink in (
            "source",
            "pointer",
            "git-index",
            "commit",
            "push",
            "deploy",
            "artifact",
            "artifact-retention",
        ):
            with self.subTest(sink=sink), self.assertRaises(PermissionError):
                runtime.require_mutation_authority(self.audit, sink)
            with self.subTest(raw_sink=sink), self.assertRaises(PermissionError):
                runtime.require_mutation_authority(  # type: ignore[arg-type]
                    runtime.FULL_MODE, sink
                )
        runtime.require_mutation_authority(self.full, "source")

    def test_c_artifact_namespace_is_pointer_run_dispatch_and_persona_specific(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            root = Path(directory)
            one = runtime.artifact_namespace(
                root / ".context/one.md",
                "run-1",
                1,
                "dispatch-1",
                "security",
                repository_root=REPO_ROOT,
            )
            two = runtime.artifact_namespace(
                root / ".context/two.md",
                "run-1",
                1,
                "dispatch-1",
                "security",
                repository_root=REPO_ROOT,
            )
            three = runtime.artifact_namespace(
                root / ".context/one.md",
                "run-1",
                1,
                "dispatch-2",
                "security",
                repository_root=REPO_ROOT,
            )
            self.assertEqual(3, len({one, two, three}))
            self.assertTrue(all(path.is_relative_to(REPO_ROOT / ".context/reviews") for path in (one, two, three)))
            with self.assertRaises(runtime.RpfContractError):
                runtime.artifact_namespace(
                    root / ".context/one.md",
                    "run-1",
                    1,
                    "dispatch-1",
                    "..",
                    repository_root=REPO_ROOT,
                )

    def test_d_e_p_root_authority_is_reconstructible_complete_and_instance_based(self) -> None:
        root = root_authority(self.fence, self.source)
        pointer = pointer_document(root)
        captured = runtime.capture_authority(
            pointer, self.fence, self.source, REPO_ROOT
        )
        self.assertTrue(runtime.captured_authority_valid(captured))
        required = set(captured["required_role_instances"])
        self.assertIn("conclusion-blind-persona:security", required)
        self.assertIn("conclusion-blind-persona:testing", required)
        self.assertNotIn("conclusion-blind-persona", required)
        aggregate_obligations = runtime.coverage_obligations_for_role(
            captured, "aggregate-result-falsifier"
        )
        self.assertIn(("probe", "claim:3"), aggregate_obligations)
        forged = dict(captured)
        forged["claim_obligations"] = {
            **captured["claim_obligations"],
            "aggregate-result-falsifier": (("probe", "claim:forged"),),
        }
        with self.assertRaises(runtime.RpfContractError):
            runtime.coverage_obligations_for_role(
                forged, "aggregate-result-falsifier"
            )
        for missing in (
            "contracts",
            "aggregate_claims",
            "selected_personas",
            "topology",
            "test_prohibitions",
            "residual_risks",
            "risk_acceptance",
            "completion_criteria",
            "ui_runtime_results",
        ):
            malformed = dict(root)
            malformed.pop(missing)
            with self.subTest(missing=missing), self.assertRaises(runtime.RpfContractError):
                runtime.capture_authority(
                    pointer_document(malformed), self.fence, self.source, REPO_ROOT
                )
        omitted_claim = dict(root)
        omitted_claim["aggregate_claims"] = {
            key: value
            for key, value in root["aggregate_claims"].items()
            if value["role_instance"] != "aggregate-result-falsifier"
        }
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(omitted_claim), self.fence, self.source, REPO_ROOT
            )
        pointer_tamper = pointer + b"\nunauthenticated claim injection\n"
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_tamper, self.fence, self.source, REPO_ROOT
            )

    def test_f_q_canonical_fence_is_total_and_rejects_placeholders(self) -> None:
        self.assertTrue(runtime.fence_shape_valid(self.fence))
        for malformed in (
            ("base", "scope", "hash"),
            (BASE, {}, "b" * 64),
            (BASE, ("../x",), "b" * 64),
            None,
        ):
            with self.subTest(malformed=malformed):
                self.assertFalse(runtime.fence_shape_valid(malformed))
        malformed_calls = (
            ([], [SOURCE_PATH], self.fence[2]),
            (BASE, [1], self.fence[2]),
            (BASE, ["missing.py"], self.fence[2]),
        )
        for base, scope, digest in malformed_calls:
            with self.subTest(scope=scope), self.assertRaises(runtime.RpfContractError):
                runtime.canonical_fence(
                    base,
                    scope,
                    digest,
                    self.source,
                    repository_root=REPO_ROOT,
                )

    def test_e2_production_cycle_reducer_requires_every_independent_role(self) -> None:
        self.source = {
            CHANGED_SOURCE_PATH: (REPO_ROOT / CHANGED_SOURCE_PATH).read_bytes()
        }
        self.fence = runtime.canonical_fence(
            BASE,
            (CHANGED_SOURCE_PATH,),
            runtime.scope_digest((CHANGED_SOURCE_PATH,), self.source),
            self.source,
            repository_root=REPO_ROOT,
        )
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        root = root_authority(self.fence, self.source)
        root["contracts"] = {}
        root["gate_results"] = [{
            "id": "GATE-NONE",
            "classification": "not-applicable",
            "affected_contract_ids": [],
            "fence": self.fence,
        }]
        root["test_prohibitions"] = []
        root["regression_watches"] = []
        root["aggregate_claims"] = {
            claim_id: claim
            for claim_id, claim in root["aggregate_claims"].items()
            if claim["role_instance"]
            not in {"regression-falsifier", "source-contract-verifier"}
        }
        captured = runtime.capture_authority(
            pointer_document(root), self.fence, self.source, REPO_ROOT,
            dispatch_ledger=ledger,
        )
        recovery = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        results: list[runtime.ValidatedChildResult] = []
        for index, role in enumerate(captured["required_role_instances"], 1):
            dispatch_id = f"cycle-role-{index}"
            obligation_pairs = runtime.coverage_obligations_for_role(
                captured, role
            )
            obligations = tuple(
                obligation_id for _, obligation_id in obligation_pairs
            )

            def evidence_for(kind: str, obligation_id: str) -> list[str]:
                if kind == "source":
                    return [
                        f"source:{obligation_id}:"
                        f"{hashlib.sha256(self.source[obligation_id]).hexdigest()}"
                    ]
                if kind == "topology":
                    family = obligation_id.removeprefix("topology:")
                    ref = root["topology"][family]["refs"][0]
                    return [f"source-ref:{ref['path']}:{ref['line']}:{ref['symbol']}"]
                if kind == "incident":
                    family = obligation_id.removeprefix("incident:")
                    ref = root["incident_coverage"][family]["refs"][0]
                    return [f"source-ref:{ref['path']}:{ref['line']}:{ref['symbol']}"]
                claim = root["aggregate_claims"][obligation_id]
                ref = claim["refs"][0]
                return [f"source-ref:{ref['path']}:{ref['line']}:{ref['symbol']}"]
            kind = "aggregate" if role == "aggregate-result-falsifier" else "review"
            payload = {
                "findings": [],
                "coverage": [
                    {
                        "obligation_id": obligation_id,
                        "disposition": "verified",
                        "evidence": evidence_for(kind, obligation_id),
                    }
                    for kind, obligation_id in obligation_pairs
                ],
                "residual_risks": [],
            }
            if kind == "aggregate":
                payload["verdict"] = "clean"
            value = {
                "protocol_version": runtime.PROTOCOL_VERSION,
                "kind": kind,
                "status": "passed",
                "role_instance": role,
                "cycle": 7,
                "run_id": "run-7",
                "dispatch_id": dispatch_id,
                "fence": {
                    "base": self.fence[0],
                    "scope": list(self.fence[1]),
                    "hash": self.fence[2],
                },
                "payload": payload,
            }
            result = self.decode(value)
            ledger.start(
                dispatch_id,
                self.limits,
                now=0,
                role_instance=role,
                cycle=7,
                run_id="run-7",
                fence=self.fence,
                obligation_ids=obligations,
            )
            ledger.accept(dispatch_id, result, now=1)
            results.append(result)
        ledger.start(
            "registered-not-launched",
            self.limits,
            now=0,
            role_instance="conclusion-blind-persona:security",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=[runtime.coverage_obligations_for_role(
                captured, "conclusion-blind-persona:security"
            )[0][1]],
        )
        reduced = runtime.evaluate_cycle_evidence(
            captured,
            results,
            dispatch_ledger=ledger,
            recovery_ledger=recovery,
        )
        self.assertEqual("converged", reduced["status"])
        peer_capture = runtime.capture_authority(
            pointer_document(
                root,
                active_run_rows=b"| peer-run | rpf | 7 | review |\n",
            ),
            self.fence,
            self.source,
            REPO_ROOT,
            dispatch_ledger=ledger,
        )
        peer_evaluation = runtime.evaluate_cycle_evidence(
            peer_capture,
            results,
            dispatch_ledger=ledger,
            recovery_ledger=recovery,
        )
        self.assertEqual("running", peer_evaluation["status"])
        self.assertEqual(1, peer_evaluation["unresolved"]["peers"])
        report_payload = dict(
            runtime.expected_cycle_report_payload(captured, reduced)
        )
        verifier_roles = {
            "aggregate-result-falsifier",
            "source-contract-verifier",
            "ui-runtime-verifier",
            "regression-falsifier",
        }
        self.assertEqual(
            len(set(captured["required_role_instances"]) - verifier_roles),
            report_payload["review_agents"],
        )
        self.assertEqual(
            len(set(captured["required_role_instances"]) & verifier_roles),
            report_payload["verify_agents"],
        )
        self.assertEqual(0, report_payload["work_agents"])
        report_envelope = {
            "protocol_version": runtime.PROTOCOL_VERSION,
            "kind": "cycle-report",
            "status": "passed",
            "role_instance": "root-controller",
            "cycle": 7,
            "run_id": "run-7",
            "dispatch_id": "cycle-report-1",
            "fence": report_payload["source_fence"],
            "payload": report_payload,
        }
        report = self.decode(report_envelope)
        ledger.start(
            "cycle-report-1",
            self.limits,
            now=0,
            role_instance="root-controller",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=[
                row["obligation_id"] for row in report_payload["coverage"]
            ],
        )
        ledger.accept("cycle-report-1", report, now=1)
        self.assertTrue(
            runtime.cycle_report_result_valid(
                report,
                captured_authority=captured,
                evaluation=reduced,
                dispatch_ledger=ledger,
            )
        )
        forged_report_envelope = copy.deepcopy(report_envelope)
        forged_report_envelope["payload"]["accepted_dispatch_ids"].append(
            "nonexistent-dispatch"
        )
        forged_report = self.decode(forged_report_envelope)
        self.assertFalse(
            runtime.cycle_report_result_valid(
                forged_report,
                captured_authority=captured,
                evaluation=reduced,
                dispatch_ledger=ledger,
            )
        )
        fully_dispatched_forgery = copy.deepcopy(report_envelope)
        fully_dispatched_forgery["dispatch_id"] = "cycle-report-forged"
        fully_dispatched_forgery["payload"]["active_peers"] = 99
        fully_dispatched_forgery["payload"]["coverage"][0]["evidence"].extend(
            [
                fully_dispatched_forgery["payload"]["coverage"][0]["evidence"][0],
                "invented-extra-proof",
            ]
        )
        forged_dispatched_result = self.decode(fully_dispatched_forgery)
        ledger.start(
            "cycle-report-forged",
            self.limits,
            now=0,
            role_instance="root-controller",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=[
                row["obligation_id"]
                for row in fully_dispatched_forgery["payload"]["coverage"]
            ],
        )
        ledger.accept("cycle-report-forged", forged_dispatched_result, now=1)
        self.assertFalse(runtime.cycle_report_result_valid(
            forged_dispatched_result,
            captured_authority=captured,
            evaluation=reduced,
            dispatch_ledger=ledger,
        ))
        incomplete = runtime.evaluate_cycle_evidence(
            captured,
            results[:-1],
            dispatch_ledger=ledger,
            recovery_ledger=recovery,
        )
        self.assertEqual("running", incomplete["status"])
        with self.assertRaises(runtime.RpfContractError):
            runtime.evaluate_cycle_evidence(
                captured,
                results[:-1],
                dispatch_ledger=ledger,
                recovery_ledger=recovery,
                completed_recovery_cycle=128,
            )
        missing_role = captured["required_role_instances"][-1]
        incomplete_report = runtime.expected_cycle_report_payload(
            captured, incomplete
        )
        self.assertTrue(all(
            row["disposition"] == "unverified"
            for row in incomplete_report["coverage"]
            if row["obligation_id"].startswith(f"{missing_role}::")
        ))
        without_aggregate = runtime.evaluate_cycle_evidence(
            captured,
            [
                result for result in results
                if result.envelope["role_instance"] != "aggregate-result-falsifier"
            ],
            dispatch_ledger=ledger,
            recovery_ledger=recovery,
        )
        self.assertGreater(without_aggregate["unresolved"]["completion"], 0)

        pending = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        self.record_recovery_failure(
            pending,
            ledger,
            "still-open",
            [obligations[0]],
            "timed-out",
            captured,
        )
        pending_snapshot = pending.snapshot()
        pending_root = dict(root)
        pending_root["recovery_state"] = {
            "format": "rpf-adaptive-recovery-v1",
            "total_cycles": 128,
            "start_cycle": 1,
            "snapshot_sha256": hashlib.sha256(pending_snapshot).hexdigest(),
            "unresolved_units": ["still-open"],
        }
        pending_capture = runtime.capture_authority(
            pointer_document(pending_root),
            self.fence,
            self.source,
            REPO_ROOT,
            recovery_snapshot=pending_snapshot,
            dispatch_ledger=ledger,
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.evaluate_cycle_evidence(
                pending_capture,
                results,
                dispatch_ledger=ledger,
                recovery_ledger=runtime.AdaptiveRecoveryLedger(total_cycles=128),
            )

    def test_e3_limit_requires_terminal_coverage_for_every_missing_role(self) -> None:
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        root = root_authority(self.fence, self.source)
        root["cycle"] = 128
        root["no_ui_detection"]["cycle"] = 128
        root["recovery_state"] = {
            "format": "rpf-adaptive-recovery-v1",
            "total_cycles": 1,
            "start_cycle": 128,
            "snapshot_sha256": hashlib.sha256(
                runtime.AdaptiveRecoveryLedger(
                    total_cycles=1, start_cycle=128
                ).snapshot()
            ).hexdigest(),
            "unresolved_units": [],
        }
        initial = runtime.capture_authority(
            pointer_document(root),
            self.fence,
            self.source,
            REPO_ROOT,
            dispatch_ledger=ledger,
        )
        recovery = runtime.AdaptiveRecoveryLedger(
            total_cycles=1, start_cycle=128
        )
        role = "conclusion-blind-persona:security"
        obligation = runtime.coverage_obligations_for_role(initial, role)[0][1]
        ledger.start(
            "final-cycle-original",
            self.limits,
            now=0,
            role_instance=role,
            cycle=128,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=[obligation],
        )
        self.attach_host(ledger, "final-cycle-original")
        ledger.expire("final-cycle-original", now=31)
        recovery.record_failure(
            "one-of-many-missing",
            obligation_ids=[obligation],
            failure_kind="timed-out",
            cycle=128,
            failed_dispatch_id="final-cycle-original",
            dispatch_ledger=ledger,
            captured_authority=initial,
        )
        action = recovery.next_action("one-of-many-missing")
        assert action is not None
        ledger.start(
            action.replacement_id,
            self.limits,
            now=0,
            role_instance=role,
            cycle=128,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=action.obligation_ids,
            recovery_action=action,
        )
        self.attach_host(ledger, action.replacement_id)
        ledger.expire(action.replacement_id, now=31)
        recovery.record_replacement_failure(
            "one-of-many-missing",
            replacement_id=action.replacement_id,
            dispatch_ledger=ledger,
            captured_authority=initial,
        )
        snapshot = recovery.snapshot()
        root["recovery_state"]["snapshot_sha256"] = hashlib.sha256(
            snapshot
        ).hexdigest()
        root["recovery_state"]["unresolved_units"] = ["one-of-many-missing"]
        captured = runtime.capture_authority(
            pointer_document(root),
            self.fence,
            self.source,
            REPO_ROOT,
            recovery_snapshot=snapshot,
            dispatch_ledger=ledger,
        )
        evaluation = runtime.evaluate_cycle_evidence(
            captured,
            [],
            dispatch_ledger=ledger,
            recovery_ledger=recovery,
            completed_recovery_cycle=128,
        )
        self.assertEqual("running", evaluation["status"])
        self.assertGreater(evaluation["unresolved"]["roles"], 1)

    def test_g_topology_requires_captured_applicability_and_closed_frontier(self) -> None:
        self.assertEqual(
            set(runtime.INCIDENT_FAMILIES),
            set(runtime.derive_incident_coverage(self.source)),
        )
        index = runtime.build_source_index(self.source)
        ref = {"path": SOURCE_PATH, "line": 1, "symbol": "producer"}
        authority = {
            family: {
                "applicable": False,
                "reason": "detected:none",
                "roots": [],
                "node_count": 1,
                "edge_count": 0,
                "budget": 1,
                "frontier": [],
                "refs": [ref],
            }
            for family in runtime.GAME_FAMILIES
        }
        rows = [
            {
                "family": family,
                "applicable": False,
                "reason": "detected:none",
                "roots": [],
                "node_count": 1,
                "edge_count": 0,
                "budget": 1,
                "frontier": [],
                "refs": [ref],
            }
            for family in runtime.GAME_FAMILIES
        ]
        self.assertTrue(
            runtime.topology_coverage_valid(
                rows, authority, index, self.fence, REPO_ROOT
            )
        )
        applicable_authority = dict(authority)
        applicable_authority["state"] = {
            "applicable": True,
            "reason": "manifest",
            "roots": [SOURCE_PATH],
            "node_count": 2,
            "edge_count": 1,
            "budget": 3,
            "frontier": [],
            "refs": [ref],
        }
        self.assertFalse(
            runtime.topology_coverage_valid(
                rows, applicable_authority, index, self.fence, REPO_ROOT
            )
        )
        state_row = next(row for row in rows if row["family"] == "state")
        state_row.update(
            applicable=True,
            reason="manifest",
            roots=[SOURCE_PATH],
            node_count=2,
            edge_count=1,
            budget=3,
        )
        self.assertTrue(
            runtime.topology_coverage_valid(
                rows, applicable_authority, index, self.fence, REPO_ROOT
            )
        )
        state_row["frontier"] = ["unread.py"]
        self.assertFalse(
            runtime.topology_coverage_valid(
                rows, applicable_authority, index, self.fence, REPO_ROOT
            )
        )

        game_source = {
            **self.source,
            GAME_PROJECT_PATH: (REPO_ROOT / GAME_PROJECT_PATH).read_bytes(),
            GAME_SCENE_PATH: (REPO_ROOT / GAME_SCENE_PATH).read_bytes(),
        }
        game_fence = runtime.canonical_fence(
            BASE,
            sorted(game_source),
            runtime.scope_digest(sorted(game_source), game_source),
            game_source,
            repository_root=REPO_ROOT,
        )
        game_root = root_authority(game_fence, game_source)
        forged_topology = {
            family: {
                **value,
                "applicable": False,
                "reason": "caller-says-not-applicable",
                "roots": [],
            }
            for family, value in game_root["topology"].items()
        }
        game_root["topology"] = forged_topology
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(game_root), game_fence, game_source, REPO_ROOT
            )

        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            project = Path(directory) / "project.godot"
            omitted_asset = Path(directory) / "effect.shader"
            project.write_text("[application]\nrun/main_scene=\"res://main.tscn\"\n")
            omitted_asset.write_text("shader_type canvas_item;\n")
            project_path = project.relative_to(REPO_ROOT).as_posix()
            incomplete_source = {
                **self.source,
                project_path: project.read_bytes(),
            }
            incomplete_fence = runtime.canonical_fence(
                BASE,
                sorted(incomplete_source),
                runtime.scope_digest(sorted(incomplete_source), incomplete_source),
                incomplete_source,
                repository_root=REPO_ROOT,
            )
            incomplete_root = root_authority(incomplete_fence, incomplete_source)
            with self.assertRaises(runtime.RpfContractError):
                runtime.capture_authority(
                    pointer_document(incomplete_root),
                    incomplete_fence,
                    incomplete_source,
                    REPO_ROOT,
                )

    def test_g2_ui_runtime_risk_is_distinct_from_static_source_evidence(self) -> None:
        ui_source = {
            **self.source,
            UI_SOURCE_PATH: (REPO_ROOT / UI_SOURCE_PATH).read_bytes(),
        }
        ui_fence = runtime.canonical_fence(
            BASE,
            sorted(ui_source),
            runtime.scope_digest(sorted(ui_source), ui_source),
            ui_source,
            repository_root=REPO_ROOT,
        )
        ui_root = root_authority(ui_fence, ui_source)
        ui_root["ui_mapping"] = runtime.derive_ui_mapping(ui_source)
        ui_root["no_ui_detection"] = None
        ui_root["ui_runtime_results"] = [
            {
                "id": f"UIR-{index}",
                "ui_id": ui_id,
                "status": "unverified-prohibited",
                "evidence_kind": "static",
                "runtime_record_id": "",
                "cycle": 7,
                "run": "run-7",
                "dispatch": "dispatch-ui",
                "fence": ui_fence,
            }
            for index, ui_id in enumerate(sorted(ui_root["ui_mapping"]), 1)
        ]
        ui_root["residual_risks"] = [
            {
                "id": "RISK-UI-1",
                "risk": "UI was not exercised at runtime",
                "verification_status": "runtime-unverified-prohibited",
                "affected_contract_ids": [],
                "ui_ids": sorted(ui_root["ui_mapping"]),
            }
        ]
        ui_root["aggregate_claims"]["claim:ui"] = {
            "role_instance": "ui-runtime-verifier",
            "claim": "runtime UI evidence remains unavailable",
            "refs": [{"path": UI_SOURCE_PATH, "line": 1, "symbol": "ShareScreen"}],
        }
        captured = runtime.capture_authority(
            pointer_document(ui_root), ui_fence, ui_source, REPO_ROOT
        )
        self.assertEqual(
            len(ui_root["ui_mapping"]), len(captured["ui_runtime_results"])
        )

        missing_risk = dict(ui_root)
        missing_risk["residual_risks"] = []
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(missing_risk), ui_fence, ui_source, REPO_ROOT
            )
        static_claims_runtime = dict(ui_root)
        static_claims_runtime["ui_runtime_results"] = [
            {**row, "status": "verified"} for row in ui_root["ui_runtime_results"]
        ]
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(static_claims_runtime),
                ui_fence,
                ui_source,
                REPO_ROOT,
            )
        not_applicable_root = copy.deepcopy(ui_root)
        not_applicable_root["ui_runtime_results"] = [
            {
                **row,
                "status": "not-applicable",
                "evidence_kind": "none",
                "runtime_record_id": "",
            }
            for row in ui_root["ui_runtime_results"]
        ]
        not_applicable_root["residual_risks"] = []
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(not_applicable_root),
                ui_fence,
                ui_source,
                REPO_ROOT,
            )
        verified_root = root_authority(ui_fence, ui_source)
        verified_root["ui_mapping"] = runtime.derive_ui_mapping(ui_source)
        verified_root["no_ui_detection"] = None
        verified_root["runtime_records"] = {
            "RR-UI-1": {
                "id": "RR-UI-1",
                "immutable": True,
                "cycle": 7,
                "run": "run-7",
                "fence": ui_fence,
                "runner": "browser-provider",
                "snapshot_id": "snapshot-1",
                "command": "repo-defined-ui-check",
                "action": "share interaction",
                "expected": "share dialog visible",
                "observed": "share dialog visible",
                "result": "passed",
            }
        }
        verified_root["ui_runtime_results"] = [
            {
                "id": f"UIR-V-{index}",
                "ui_id": ui_id,
                "status": "verified",
                "evidence_kind": "runtime",
                "runtime_record_id": "RR-UI-1",
                "cycle": 7,
                "run": "run-7",
                "dispatch": "dispatch-ui-verified",
                "fence": ui_fence,
            }
            for index, ui_id in enumerate(sorted(verified_root["ui_mapping"]), 1)
        ]
        verified_root["residual_risks"] = []
        verified_root["aggregate_claims"]["claim:ui"] = {
            "role_instance": "ui-runtime-verifier",
            "claim": "runtime UI evidence is current",
            "refs": [{"path": UI_SOURCE_PATH, "line": 1, "symbol": "ShareScreen"}],
        }
        ui_ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        expected_ui_coverage = tuple(
            obligation_id
            for _, obligation_id in runtime.coverage_obligations_for_role(
                captured, "ui-runtime-verifier"
            )
        )
        ui_ledger.start(
            "dispatch-ui-verified",
            self.limits,
            now=0,
            role_instance="ui-runtime-verifier",
            cycle=7,
            run_id="run-7",
            fence=ui_fence,
            obligation_ids=expected_ui_coverage,
        )
        ui_envelope = envelope(
            ui_fence,
            kind="ui-runtime",
            status="verified",
            dispatch_id="dispatch-ui-verified",
        )
        ui_envelope["role_instance"] = "ui-runtime-verifier"
        ui_envelope["payload"]["ui_rows"] = verified_root["ui_runtime_results"]
        ui_envelope["payload"]["coverage"] = [
            {
                "obligation_id": ui_id,
                "disposition": "verified",
                "evidence": ["runtime-provider-receipt"],
            }
            for ui_id in expected_ui_coverage
        ]
        ui_result = self.decode(ui_envelope)
        ui_ledger.accept("dispatch-ui-verified", ui_result, now=1)
        with self.assertRaises(runtime.RpfContractError):
            runtime.register_runtime_evidence_provider(
                provider_id="browser-provider",
                executor_id="browser-runner",
                observer_id="browser-observer",
                execute=HostAdapter(lambda _: {}).invoke,
                observe=HostAdapter(lambda _: {}).invoke,
                authority=self.full,
            )
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(verified_root),
                ui_fence,
                ui_source,
                REPO_ROOT,
                validated_results=[ui_result],
                dispatch_ledger=ui_ledger,
            )
    def test_h_source_contract_requires_typed_resolvable_references(self) -> None:
        index = runtime.build_source_index(self.source)
        producer = {"path": SOURCE_PATH, "line": 1, "symbol": "producer"}
        consumer = {"path": SOURCE_PATH, "line": 5, "symbol": "consumer"}
        claim = {"claim": "producer returns value", "refs": [producer]}
        captured = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        row = {
            "id": "SC-1",
            "contract": "save contract",
            "producer": producer,
            "consumers": [consumer],
            "inputs": [{"name": "request", "type": "none", "source_ref": consumer}],
            "outputs": [{"name": "result", "type": "int", "source_ref": producer}],
            "invariants": [claim],
            "success": {"claim": "success returns one", "refs": [producer]},
            "error": {"claim": "error is surfaced", "refs": [consumer]},
            "variants": {"claim": "variant keeps integer type", "refs": [consumer]},
            "counterexample": {"claim": "noninteger would falsify", "refs": [consumer]},
            "evidence": [producer, consumer],
            "residual_risk": "runtime not executed",
            "status": "verified",
            "rev": 1,
            "cycle": 7,
            "run_id": "run-7",
            "dispatch_id": "dispatch-source-contract",
            "fence": self.fence,
            "coverage_ids": ["SC-1:producer", "SC-1:consumer"],
            "provenance": {
                "producer_ref": producer,
                "consumer_refs": [consumer],
                "evidence_refs": [producer, consumer],
            },
        }
        self.assertTrue(
            runtime.source_contract_valid(
                row,
                captured_authority=captured,
                source_index=index,
                approved_fence=self.fence,
                repository_root=REPO_ROOT,
            )
        )
        self.assertFalse(
            runtime.source_contract_valid(
                {**row, "inputs": [row["inputs"][0], row["inputs"][0]]},
                captured_authority=captured,
                source_index=index,
                approved_fence=self.fence,
                repository_root=REPO_ROOT,
            )
        )
        source_obligations = tuple(
            obligation_id
            for _, obligation_id in runtime.coverage_obligations_for_role(
                captured, "source-contract-verifier"
            )
        )
        source_envelope = {
            "protocol_version": runtime.PROTOCOL_VERSION,
            "kind": "source-contract",
            "status": "passed",
            "role_instance": "source-contract-verifier",
            "cycle": 7,
            "run_id": "run-7",
            "dispatch_id": "dispatch-source-contract",
            "fence": {
                "base": self.fence[0],
                "scope": list(self.fence[1]),
                "hash": self.fence[2],
            },
            "payload": {
                "contracts": [row],
                "coverage": [{
                    "obligation_id": obligation_id,
                    "disposition": "verified",
                    "evidence": ["typed-source-contract-evidence"],
                } for obligation_id in source_obligations],
                "residual_risks": [],
            },
        }
        source_result = self.decode(source_envelope)
        source_ledger = runtime.DispatchLedger(
            self.cancellation, authority=self.full
        )
        source_ledger.start(
            "dispatch-source-contract",
            self.limits,
            now=0,
            role_instance="source-contract-verifier",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=source_obligations,
        )
        source_ledger.accept("dispatch-source-contract", source_result, now=1)
        self.assertTrue(
            runtime.source_contract_result_valid(
                [row],
                result=source_result,
                dispatch_ledger=source_ledger,
                captured_authority=captured,
                source_index=index,
            )
        )
        self.assertFalse(
            runtime.source_contract_result_valid(
                [{**row, "dispatch_id": "different-dispatch"}],
                result=source_result,
                dispatch_ledger=source_ledger,
                captured_authority=captured,
                source_index=index,
            )
        )
        self.assertFalse(
            runtime.source_contract_valid(
                {**row, "error": row["success"]},
                captured_authority=captured,
                source_index=index,
                approved_fence=self.fence,
                repository_root=REPO_ROOT,
            )
        )
        self.assertFalse(
            runtime.source_contract_valid(
                {
                    **row,
                    "inputs": [{
                        "name": "request",
                        "type": "none",
                        "source_ref": producer,
                    }],
                    "outputs": [{
                        "name": "result",
                        "type": "int",
                        "source_ref": consumer,
                    }],
                },
                captured_authority=captured,
                source_index=index,
                approved_fence=self.fence,
                repository_root=REPO_ROOT,
            )
        )
        for field, value in (
            ("producer", "p"),
            ("consumers", {}),
            ("inputs", []),
            ("outputs", []),
            ("success", "s"),
            ("evidence", "src:1"),
        ):
            with self.subTest(field=field):
                self.assertFalse(
                    runtime.source_contract_valid(
                        {**row, field: value},
                        captured_authority=captured,
                        source_index=index,
                        approved_fence=self.fence,
                        repository_root=REPO_ROOT,
                    )
                )
        forged_index = {path: dict(entry) for path, entry in index.items()}
        forged_index[SOURCE_PATH]["lines"] = ("forged producer",)
        self.assertFalse(
            runtime.source_contract_valid(
                row,
                captured_authority=captured,
                source_index=forged_index,
                approved_fence=self.fence,
                repository_root=REPO_ROOT,
            )
        )

    def test_i_j_strict_child_protocol_rejects_injection_and_malformed_transport(self) -> None:
        valid = envelope(self.fence)
        self.assertEqual("passed", self.decode(valid).envelope["status"])
        raw = json.dumps(valid).encode()
        for candidate, finish_reason in (
            (raw + b" trailing", "stop"),
            (raw[:-1], "stop"),
            (raw, "length"),
            (json.dumps({**valid, "unknown": True}).encode(), "stop"),
            (b'{"protocol_version":"x","protocol_version":"y"}', "stop"),
            (raw.replace(b'"findings": []', b'"findings": ["CONTROLLER-CANARY"]'), "stop"),
            (
                raw.replace(
                    b'"findings": []',
                    b'"findings": ["CONTROLLER-C\\u0041NARY"]',
                ),
                "stop",
            ),
            (b"I refuse", "stop"),
        ):
            with self.subTest(candidate=candidate[:30], finish_reason=finish_reason):
                with self.assertRaises(runtime.RpfContractError):
                    runtime.decode_child_result(
                        candidate,
                        finish_reason=finish_reason,
                        limits=self.limits,
                        controller_canary="CONTROLLER-CANARY",
                    )
        scope_request = self.decode(
            envelope(
                self.fence,
                kind="needs-scope-expansion",
                status="incomplete",
            )
        )
        self.assertEqual("needs-scope-expansion", scope_request.envelope["kind"])

    def test_k_only_controller_validated_output_reaches_artifact_sink(self) -> None:
        captured_root = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        expected = tuple(
            obligation_id
            for _, obligation_id in runtime.coverage_obligations_for_role(
                captured_root, "conclusion-blind-persona:security"
            )
        )
        result_envelope = envelope(self.fence)
        result_envelope["payload"]["coverage"] = [
            {
                "obligation_id": obligation_id,
                "disposition": "verified",
                "evidence": ["source-ref"],
            }
            for obligation_id in expected
        ]
        result = self.decode(result_envelope)
        identity = {
            "role_instance": "conclusion-blind-persona:security",
            "cycle": 7,
            "run_id": "run-7",
            "fence": self.fence,
        }
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        ledger.start(
            "dispatch-1", self.limits, now=0, obligation_ids=expected, **identity
        )
        ledger.accept("dispatch-1", result, now=1)
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            pointer = Path(directory) / ".context" / "rpf.md"
            pointer.parent.mkdir()
            pointer.write_bytes(pointer_document(root_authority(self.fence, self.source)))
            captured = runtime.capture_authority(
                pointer.read_bytes(), self.fence, self.source, REPO_ROOT
            )
            target = runtime.publish_validated_artifact(
                pointer,
                "review.json",
                result,
                authority=self.full,
                ledger=ledger,
                captured_authority=captured,
            )
            self.assertEqual(result.raw, target.read_bytes())
            self.assertTrue(
                target.is_relative_to((REPO_ROOT / ".context" / "reviews").resolve())
            )
            artifact_checks = 0
            native_directory_match = runtime._directory_matches_fd

            def artifact_directory_changes(directory: Path, descriptor: int) -> bool:
                nonlocal artifact_checks
                if ".context/reviews" in directory.as_posix():
                    artifact_checks += 1
                    return artifact_checks == 1
                return native_directory_match(directory, descriptor)

            with mock.patch.object(
                runtime,
                "_directory_matches_fd",
                side_effect=artifact_directory_changes,
            ), self.assertRaises(runtime.RpfConflictError):
                runtime.publish_validated_artifact(
                    pointer,
                    "raced.json",
                    result,
                    authority=self.full,
                    ledger=ledger,
                    captured_authority=captured,
                )
            self.assertFalse(target.with_name("raced.json").exists())
            with self.assertRaises(runtime.RpfContractError):
                runtime.publish_validated_artifact(  # type: ignore[arg-type]
                    pointer,
                    "raw.json",
                    b"raw",
                    authority=self.full,
                    ledger=ledger,
                    captured_authority=captured,
                )
            with self.assertRaises(PermissionError):
                runtime.publish_validated_artifact(
                    pointer,
                    "audit.json",
                    result,
                    authority=self.audit,
                    ledger=ledger,
                    captured_authority=captured,
                )
            other_ledger = runtime.DispatchLedger(
                self.cancellation, authority=self.full
            )
            other_ledger.start(
                "dispatch-1",
                self.limits,
                now=0,
                obligation_ids=expected,
                **identity,
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.publish_validated_artifact(
                    pointer,
                    "forged.json",
                    result,
                    authority=self.full,
                    ledger=other_ledger,
                    captured_authority=captured,
                )
            with self.assertRaises(TypeError):
                result.envelope["status"] = "failed"  # type: ignore[index]
    def test_l_phase_zero_classifier_never_returns_secret_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            protected = Path(directory) / ".env"
            fake_value = "not-a-real-credential-value"
            protected.write_text("PASSWORD=" + fake_value, encoding="utf-8")
            classified = runtime.classify_path(
                protected, repository_root=Path(directory)
            )
            self.assertEqual("protected", classified.disposition)
            self.assertNotIn(fake_value, repr(classified))
            source = Path(directory) / "source.py"
            source.write_text("api_key=" + fake_value, encoding="utf-8")
            restricted = runtime.classify_path(
                source, repository_root=Path(directory)
            )
            self.assertEqual("restricted", restricted.disposition)
            self.assertIsNotNone(restricted.incident_id)
            self.assertNotIn(fake_value, repr(restricted))
            cli = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "rpf_runtime.py"), "classify", str(source)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(2, cli.returncode)
            self.assertNotIn(fake_value, cli.stdout + cli.stderr)
            safe = Path(directory) / "safe.txt"
            safe.write_text("approved", encoding="utf-8")
            approval = runtime.classify_path(
                safe, repository_root=Path(directory)
            )
            safe.write_text("changed", encoding="utf-8")
            with self.assertRaises(runtime.RpfConflictError):
                runtime.read_approved(
                    safe, approval, repository_root=Path(directory)
                )

    def test_m_dispatch_deadline_cancellation_barrier_and_late_tombstone(self) -> None:
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        identity = {
            "role_instance": "conclusion-blind-persona:security",
            "cycle": 7,
            "run_id": "run-7",
            "fence": self.fence,
        }
        ledger.start(
            "dispatch-1", self.limits, now=0, obligation_ids=["ROLE-1"], **identity
        )
        ledger.start(
            "dispatch-2", self.limits, now=0, obligation_ids=["ROLE-1"], **identity
        )
        result = self.decode(envelope(self.fence, dispatch_id="dispatch-1"))
        ledger.accept("dispatch-1", result, now=1)
        self.attach_host(ledger, "dispatch-2")
        self.assertTrue(ledger.expire("dispatch-2", now=31))
        row = ledger.snapshot("dispatch-2")
        self.assertTrue(row["cancel_descendants"])
        self.assertTrue(row["stream_closed"])
        self.assertTrue(ledger.barrier_terminal(["dispatch-1", "dispatch-2"]))
        late = self.decode(envelope(self.fence, dispatch_id="dispatch-2"))
        with self.assertRaises(runtime.RpfContractError):
            ledger.accept("dispatch-2", late, now=32)
        ledger.start(
            "dispatch-3", self.limits, now=0, obligation_ids=["ROLE-1"], **identity
        )
        wrong_role = self.decode(
            {
                **envelope(self.fence, dispatch_id="dispatch-3"),
                "role_instance": "conclusion-blind-persona:testing",
            }
        )
        with self.assertRaises(runtime.RpfContractError):
            ledger.accept("dispatch-3", wrong_role, now=1)
        unattached = runtime.DispatchLedger(
            runtime.create_os_cancellation_provider(), authority=self.full
        )
        unattached.start(
            "dispatch-unattached",
            self.limits,
            now=0,
            obligation_ids=["ROLE-1"],
            **identity,
        )
        self.assertTrue(unattached.expire("dispatch-unattached", now=31))
        unattached_row = unattached.snapshot("dispatch-unattached")
        self.assertEqual("incomplete", unattached_row["state"])
        self.assertEqual("provider-unavailable", unattached_row["failure_reason"])
        ledger.start(
            "dispatch-4", self.limits, now=0, obligation_ids=["ROLE-1"], **identity
        )
        self.attach_host(ledger, "dispatch-4")
        deadline_result = self.decode(envelope(self.fence, dispatch_id="dispatch-4"))
        with self.assertRaises(runtime.RpfContractError):
            ledger.accept("dispatch-4", deadline_result, now=30)
        self.assertEqual("timed-out", ledger.snapshot("dispatch-4")["state"])
        for bad in (
            runtime.DispatchLimits(0, 1, 1),
            runtime.DispatchLimits(float("inf"), 1, 1),
            runtime.DispatchLimits(1, 0, 1),
            runtime.DispatchLimits(1, 1, 0),
        ):
            with self.assertRaises(runtime.RpfContractError):
                bad.validate()
        audit_source = {
            CHANGED_SOURCE_PATH: (REPO_ROOT / CHANGED_SOURCE_PATH).read_bytes()
        }
        audit_fence = runtime.canonical_fence(
            BASE,
            (CHANGED_SOURCE_PATH,),
            runtime.scope_digest((CHANGED_SOURCE_PATH,), audit_source),
            audit_source,
            repository_root=REPO_ROOT,
        )
        audit_ledger = runtime.DispatchLedger(
            self.cancellation, authority=self.audit
        )
        audit_ledger.start(
            "audit-cycle-zero",
            self.limits,
            now=0,
            role_instance="pointer-alignment",
            cycle=0,
            run_id="audit-run",
            fence=audit_fence,
            obligation_ids=["audit:pointer-alignment"],
        )
        with self.assertRaises(runtime.RpfContractError):
            audit_ledger.start(
                "audit-cycle-one",
                self.limits,
                now=0,
                role_instance="pointer-alignment",
                cycle=1,
                run_id="audit-run",
                fence=audit_fence,
                obligation_ids=["audit:pointer-alignment"],
            )
        audit_capture = runtime.capture_audit_authority(
            audit_fence, audit_source, REPO_ROOT, run_id="audit-run",
            dispatch_ledger=audit_ledger,
        )
        self.assertTrue(runtime.captured_authority_valid(audit_capture))
        audit_results: list[runtime.ValidatedChildResult] = []
        for index, role in enumerate(audit_capture["required_role_instances"], 1):
            obligation_pairs = runtime.coverage_obligations_for_role(
                audit_capture, role
            )
            audit_dispatch_id = f"audit-role-{index}"
            kind = "aggregate" if role == "aggregate-result-falsifier" else "review"
            payload = {
                "findings": [],
                "coverage": [{
                    "obligation_id": obligation_id,
                    "disposition": "verified",
                    "evidence": grounded_evidence(
                        audit_capture, role, obligation_id
                    ),
                } for _, obligation_id in obligation_pairs],
                "residual_risks": [],
            }
            if kind == "aggregate":
                payload["verdict"] = "clean"
            audit_value = {
                "protocol_version": runtime.PROTOCOL_VERSION,
                "kind": kind,
                "status": "passed",
                "role_instance": role,
                "cycle": 0,
                "run_id": "audit-run",
                "dispatch_id": audit_dispatch_id,
                "fence": {
                    "base": audit_fence[0],
                    "scope": list(audit_fence[1]),
                    "hash": audit_fence[2],
                },
                "payload": payload,
            }
            audit_result = self.decode(audit_value)
            audit_ledger.start(
                audit_dispatch_id,
                self.limits,
                now=0,
                role_instance=role,
                cycle=0,
                run_id="audit-run",
                fence=audit_fence,
                obligation_ids=[item[1] for item in obligation_pairs],
            )
            audit_ledger.accept(audit_dispatch_id, audit_result, now=1)
            audit_results.append(audit_result)
        audit_evaluation = runtime.evaluate_cycle_evidence(
            audit_capture,
            audit_results,
            dispatch_ledger=audit_ledger,
            recovery_ledger=runtime.AdaptiveRecoveryLedger(total_cycles=1),
        )
        self.assertEqual("audit-complete", audit_evaluation["status"])
        restricted_obligations = [
            item[1] for item in runtime.coverage_obligations_for_role(
                audit_capture, "pointer-alignment"
            )
        ]
        audit_ledger.start(
            "audit-restricted",
            self.limits,
            now=0,
            role_instance="pointer-alignment",
            cycle=0,
            run_id="audit-run",
            fence=audit_fence,
            obligation_ids=restricted_obligations,
        )
        restricted_value = envelope(
            audit_fence,
            kind="restricted",
            status="restricted",
            dispatch_id="audit-restricted",
        )
        restricted_value["cycle"] = 0
        restricted_value["run_id"] = "audit-run"
        restricted_value["role_instance"] = "pointer-alignment"
        restricted_value["payload"]["obligation_ids"] = restricted_obligations
        audit_ledger.accept(
            "audit-restricted", self.decode(restricted_value), now=1
        )
        restricted_audit = runtime.evaluate_cycle_evidence(
            audit_capture,
            [],
            dispatch_ledger=audit_ledger,
            recovery_ledger=runtime.AdaptiveRecoveryLedger(total_cycles=1),
        )
        self.assertEqual("running", restricted_audit["status"])
        self.assertGreater(restricted_audit["unresolved"]["restricted"], 0)
        incomplete_report = runtime.expected_cycle_report_payload(
            audit_capture, restricted_audit
        )
        self.assertTrue(incomplete_report["coverage"])
        self.assertTrue(all(
            row["disposition"] == "unverified"
            for row in incomplete_report["coverage"]
        ))
        with self.assertRaises(runtime.RpfContractError):
            ledger.start(
                "full-cycle-zero",
                self.limits,
                now=0,
                role_instance="pointer-alignment",
                cycle=0,
                run_id="run-0",
                fence=self.fence,
                obligation_ids=["ROLE-1"],
            )
        no_op = runtime.CancellationProvider(
            lambda _: None,  # type: ignore[arg-type]
            lambda _: None,  # type: ignore[arg-type]
            lambda _: None,  # type: ignore[arg-type]
            lambda dispatch_id: {
                "dispatch_id": dispatch_id,
                "interrupt_observed": True,
                "descendants_observed": True,
                "stream_closed_observed": True,
            },
        )
        with self.assertRaises(runtime.RpfContractError):
            no_op.validate(execute_probe=True)
        for command in (
            ["sh", "-c", "printenv"],
            ["rg", "token", "."],
            ["git", "status", "$HOME"],
            ["rg", "x", ".env"],
        ):
            with self.subTest(command=command), self.assertRaises(
                runtime.RpfContractError
            ):
                runtime.safe_command_preflight(command, repository_root=REPO_ROOT)
        with self.assertRaises(runtime.RpfContractError):
            runtime.safe_command_preflight(
                ["git", "status", "--short"], repository_root=REPO_ROOT
            )

    def test_n_open_watch_must_be_carried_to_every_new_fence(self) -> None:
        other_source = {
            **self.source,
            CHANGED_SOURCE_PATH: (REPO_ROOT / CHANGED_SOURCE_PATH).read_bytes(),
        }
        other_hash = runtime.scope_digest(sorted(other_source), other_source)
        other_fence = runtime.canonical_fence(
            BASE, sorted(other_source), other_hash, other_source, repository_root=REPO_ROOT
        )
        watches = root_authority(self.fence, self.source)["regression_watches"]
        carried = runtime.carry_open_watches(
            watches, other_fence, current_cycle=7
        )
        self.assertEqual(other_fence, carried[0]["fence"])
        self.assertEqual(2, carried[0]["rev"])
        stale_root = root_authority(other_fence, other_source)
        stale_root["regression_watches"] = watches
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(stale_root), other_fence, other_source, REPO_ROOT
            )

    def test_n1_technical_failures_recover_without_a_blocked_transition(self) -> None:
        recovery = runtime.TechnicalRecoveryLedger()
        for failure_kind in recovery.failure_kinds():
            failure_id = recovery.record_failure(failure_kind=failure_kind)
            self.assertEqual(
                failure_id,
                recovery.record_failure(failure_kind=failure_kind),
            )
            expected = runtime.TechnicalRecoveryLedger._STRATEGIES[failure_kind]
            for strategy in expected:
                action = recovery.next_action(failure_id)
                assert action is not None
                self.assertEqual(strategy, action.strategy)
                recovery.finish_action(action, recovered=False)
            carried = recovery.next_action(failure_id)
            assert carried is not None
            self.assertEqual("carry-forward-retry", carried.strategy)
            recovery.finish_action(carried, recovered=False)

        self.assertEqual("running", recovery.run_status())
        self.assertEqual(
            "limit-reached", recovery.run_status(invocation_limit_reached=True)
        )
        self.assertNotIn(b"blocked", recovery.snapshot())

        first = recovery.unresolved_failures()[0]
        resolved = recovery.next_action(first)
        assert resolved is not None
        with self.assertRaises(runtime.RpfContractError):
            recovery.finish_action(dataclasses.replace(resolved), recovered=True)
        recovery.finish_action(resolved, recovered=True)
        self.assertNotIn(first, recovery.unresolved_failures())
        with self.assertRaises(runtime.RpfContractError):
            recovery.record_failure(failure_kind="semantic-conflict")

        reopened = recovery.record_failure(
            failure_kind=first.removeprefix("TECH-").lower()
        )
        self.assertEqual(first, reopened)
        self.assertIn(first, recovery.unresolved_failures())
        restarted = recovery.next_action(first)
        assert restarted is not None
        self.assertEqual(
            runtime.TechnicalRecoveryLedger._STRATEGIES[
                first.removeprefix("TECH-").lower()
            ][0],
            restarted.strategy,
        )
        recovery.finish_action(restarted, recovered=False)

        process_recovery = runtime.TechnicalRecoveryLedger()
        process_failure = process_recovery.record_failure(
            failure_kind="bundle-refresh"
        )
        interrupted = process_recovery.next_action(process_failure)
        assert interrupted is not None
        exported = process_recovery.export_state(
            authentication_key=self.restart_key
        )
        restored = runtime.TechnicalRecoveryLedger.from_snapshot(
            exported, authentication_key=self.restart_key
        )
        reconciliation = restored.next_action(process_failure)
        assert reconciliation is not None
        self.assertEqual("reconcile-interrupted-attempt", reconciliation.strategy)
        restored.finish_action(reconciliation, recovered=False)
        next_distinct = restored.next_action(process_failure)
        assert next_distinct is not None
        self.assertEqual("pin-verified-ancestor-bundle", next_distinct.strategy)
        restored.finish_action(next_distinct, recovered=False)

        with self.assertRaises(runtime.RpfContractError):
            runtime.TechnicalRecoveryLedger.from_snapshot(
                process_recovery.snapshot(), authentication_key=self.restart_key
            )
        with self.assertRaises(runtime.RpfContractError):
            runtime.TechnicalRecoveryLedger.from_snapshot(
                exported,
                authentication_key=runtime.create_restart_authentication_key(),
            )
        authenticated_payload = json.loads(exported)["payload"]
        forged_payload = copy.deepcopy(authenticated_payload)
        forged_payload["rows"][process_failure]["failure_kind"] = "push"
        with self.assertRaises(runtime.RpfContractError):
            runtime.TechnicalRecoveryLedger.from_snapshot(
                runtime._encode_authenticated_state(
                    forged_payload, authentication_key=self.restart_key
                ),
                authentication_key=self.restart_key,
            )
        impossible_pending = copy.deepcopy(authenticated_payload)
        impossible_pending["rows"][process_failure][
            "interrupted_strategy"
        ] = "retry-bundle-pin"
        with self.assertRaises(runtime.RpfContractError):
            runtime.TechnicalRecoveryLedger.from_snapshot(
                runtime._encode_authenticated_state(
                    impossible_pending, authentication_key=self.restart_key
                ),
                authentication_key=self.restart_key,
            )

    def test_n2_barrier_failures_adapt_and_continue_instead_of_stalled_stop(self) -> None:
        recovery = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        captured = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        authorized_obligation = runtime.coverage_obligations_for_role(
            captured, "conclusion-blind-persona:security"
        )[0][1]
        provider_recovery = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        ledger.start(
            "provider-missing-host",
            self.limits,
            now=0,
            role_instance="conclusion-blind-persona:security",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=[authorized_obligation],
        )
        ledger.expire("provider-missing-host", now=31)
        provider_recovery.record_failure(
            "provider-unit",
            obligation_ids=[authorized_obligation],
            failure_kind="provider-unavailable",
            cycle=7,
            failed_dispatch_id="provider-missing-host",
            dispatch_ledger=ledger,
            captured_authority=captured,
        )
        provider_action = provider_recovery.next_action("provider-unit")
        assert provider_action is not None
        self.assertEqual("controller-static-review", provider_action.strategy)
        ledger.start(
            provider_action.replacement_id,
            self.limits,
            now=0,
            role_instance="conclusion-blind-persona:security",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=provider_action.obligation_ids,
            recovery_action=provider_action,
            captured_authority=captured,
        )
        restricted_replacement = envelope(
            self.fence,
            kind="restricted",
            status="restricted",
            dispatch_id=provider_action.replacement_id,
        )
        restricted_replacement["payload"]["obligation_ids"] = list(
            provider_action.obligation_ids
        )
        with self.assertRaises(runtime.RpfContractError):
            ledger.accept(
                provider_action.replacement_id,
                self.decode(restricted_replacement),
                now=1,
            )
        provider_recovery.record_replacement_failure(
            "provider-unit",
            replacement_id=provider_action.replacement_id,
            dispatch_ledger=ledger,
            captured_authority=captured,
        )
        unit_ids: list[str] = []
        for index in range(7):
            unit_id = f"timeout-{index}"
            unit_ids.append(unit_id)
            self.record_recovery_failure(
                recovery,
                ledger,
                unit_id,
                [authorized_obligation],
                "timed-out",
                captured,
            )
        for index in range(3):
            unit_id = f"coverage-{index}"
            unit_ids.append(unit_id)
            self.record_recovery_failure(
                recovery,
                ledger,
                unit_id,
                [authorized_obligation],
                "invalid-coverage",
                captured,
            )

        actions = [recovery.next_action(unit_id) for unit_id in unit_ids]
        self.assertEqual(10, len({action.replacement_id for action in actions if action}))
        self.assertEqual(
            {"redispatch-smaller-context", "schema-repair-redispatch"},
            {action.strategy for action in actions if action},
        )
        self.assertEqual(
            "running",
            recovery.run_status(
                completed_cycle=5, goal_gaps=10, dispatch_ledger=ledger
            ),
        )
        self.assertFalse(recovery.finding_promotable("coverage-0"))
        accepted_action = actions[7]
        self.assertIsNotNone(accepted_action)
        assert accepted_action is not None
        identity = {
            "role_instance": "conclusion-blind-persona:security",
            "cycle": 7,
            "run_id": "run-7",
            "fence": self.fence,
        }
        ledger.start(
            accepted_action.replacement_id,
            self.limits,
            now=0,
            obligation_ids=accepted_action.obligation_ids,
            recovery_action=accepted_action,
            **identity,
        )
        exact_envelope = envelope(
            self.fence, dispatch_id=accepted_action.replacement_id
        )
        exact_envelope["payload"]["coverage"] = [
            {
                "obligation_id": authorized_obligation,
                "disposition": "verified",
                "evidence": grounded_evidence(
                    captured,
                    "conclusion-blind-persona:security",
                    authorized_obligation,
                ),
            }
        ]
        exact_result = self.decode(exact_envelope)
        ledger.accept(accepted_action.replacement_id, exact_result, now=1)
        with self.assertRaises(runtime.RpfContractError):
            recovery.accept_exact_coverage(
                "coverage-1",
                result=exact_result,
                dispatch_ledger=ledger,
                captured_authority=captured,
            )
        recovery.accept_exact_coverage(
            "coverage-0",
            result=exact_result,
            dispatch_ledger=ledger,
            captured_authority=captured,
        )
        self.assertTrue(recovery.finding_promotable("coverage-0"))
        restored = runtime.AdaptiveRecoveryLedger.from_snapshot(
            recovery.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            accepted_results=[exact_result],
            dispatch_ledger=ledger,
            captured_authority=captured,
        )
        self.assertTrue(restored.finding_promotable("coverage-0"))
        duplicated_snapshot = json.loads(recovery.snapshot())
        duplicated_snapshot["rows"]["forged-duplicate"] = dict(
            duplicated_snapshot["rows"]["coverage-0"]
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger.from_snapshot(
                runtime._encode_authenticated_state(
                    duplicated_snapshot, authentication_key=self.restart_key
                ),
                authentication_key=self.restart_key,
                accepted_results=[exact_result],
                dispatch_ledger=ledger,
                captured_authority=captured,
            )
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger.from_snapshot(
                recovery.export_state(authentication_key=self.restart_key),
                authentication_key=self.restart_key,
            )
        self.assertEqual(
            "running",
            recovery.run_status(
                completed_cycle=128,
                goal_gaps=9,
                dispatch_ledger=ledger,
            ),
        )
        self.assertEqual(
            "waiting-user",
            recovery.run_status(
                completed_cycle=5,
                goal_gaps=9,
                dispatch_ledger=ledger,
                user_authority_required=True,
            ),
        )
        first_timeout_action = actions[0]
        assert first_timeout_action is not None

        def fail_action(action: runtime.RecoveryAction) -> None:
            static = action.strategy == "controller-static-review"
            ledger.start(
                action.replacement_id,
                self.limits,
                now=0,
                role_instance="conclusion-blind-persona:security",
                cycle=action.cycle,
                run_id="run-7",
                fence=self.fence,
                obligation_ids=action.obligation_ids,
                recovery_action=action,
                captured_authority=(
                    captured_for_cycle(action.cycle) if static else None
                ),
            )
            if static:
                failed = envelope(
                    self.fence,
                    kind="incomplete",
                    status="incomplete",
                    dispatch_id=action.replacement_id,
                )
                failed["cycle"] = action.cycle
                failed["payload"]["obligation_ids"] = list(
                    action.obligation_ids
                )
                ledger.accept(
                    action.replacement_id, self.decode(failed), now=1
                )
            else:
                self.attach_host(ledger, action.replacement_id)
                ledger.expire(action.replacement_id, now=31)

        def captured_for_cycle(cycle: int) -> object:
            if cycle == 7:
                return captured
            cycle_root = root_authority(self.fence, self.source)
            cycle_root["cycle"] = cycle
            cycle_root["no_ui_detection"]["cycle"] = cycle
            return runtime.capture_authority(
                pointer_document(cycle_root), self.fence, self.source, REPO_ROOT
            )

        fail_action(first_timeout_action)
        recovery.record_replacement_failure(
            "timeout-0",
            replacement_id=first_timeout_action.replacement_id,
            dispatch_ledger=ledger,
            captured_authority=captured_for_cycle(first_timeout_action.cycle),
        )
        for expected_strategy in (
            "split-atomic-obligations",
            "controller-static-review",
        ):
            next_action = recovery.next_action("timeout-0")
            self.assertIsNotNone(next_action)
            assert next_action is not None
            self.assertEqual(expected_strategy, next_action.strategy)
            fail_action(next_action)
            recovery.record_replacement_failure(
                "timeout-0",
                replacement_id=next_action.replacement_id,
                dispatch_ledger=ledger,
                captured_authority=captured_for_cycle(next_action.cycle),
            )
        self.assertIsNone(recovery.next_action("timeout-0"))
        carry_8 = recovery.carry_to_cycle("timeout-0", cycle=8)
        self.assertEqual("carry-forward-new-cycle", carry_8.strategy)
        fail_action(carry_8)
        recovery.record_replacement_failure(
            "timeout-0",
            replacement_id=carry_8.replacement_id,
            dispatch_ledger=ledger,
            captured_authority=captured_for_cycle(carry_8.cycle),
        )
        carry_9 = recovery.carry_to_cycle("timeout-0", cycle=9)
        self.assertNotEqual(carry_8.replacement_id, carry_9.replacement_id)
        cycle_9_root = root_authority(self.fence, self.source)
        cycle_9_root["cycle"] = 9
        cycle_9_root["no_ui_detection"]["cycle"] = 9
        captured_9 = runtime.capture_authority(
            pointer_document(cycle_9_root), self.fence, self.source, REPO_ROOT
        )
        cycle_9_identity = {**identity, "cycle": 9}
        ledger.start(
            carry_9.replacement_id,
            self.limits,
            now=2,
            obligation_ids=carry_9.obligation_ids,
            recovery_action=carry_9,
            **cycle_9_identity,
        )
        carried_envelope = envelope(
            self.fence, dispatch_id=carry_9.replacement_id
        )
        carried_envelope["cycle"] = 9
        carried_envelope["payload"]["coverage"] = [
            {
                "obligation_id": authorized_obligation,
                "disposition": "verified",
                "evidence": grounded_evidence(
                    captured_9,
                    "conclusion-blind-persona:security",
                    authorized_obligation,
                ),
            }
        ]
        carried_result = self.decode(carried_envelope)
        ledger.accept(carry_9.replacement_id, carried_result, now=3)
        with self.assertRaises(runtime.RpfContractError):
            recovery.accept_exact_coverage(
                "timeout-0",
                result=carried_result,
                dispatch_ledger=ledger,
                captured_authority=captured,
            )
        recovery.accept_exact_coverage(
            "timeout-0",
            result=carried_result,
            dispatch_ledger=ledger,
            captured_authority=captured_9,
        )
        self.assertTrue(recovery.finding_promotable("timeout-0"))
        restored_dispatch_ledger = runtime.DispatchLedger.from_state(
            ledger.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            cancellation_provider=runtime.create_os_cancellation_provider(),
            authority=self.full,
        )
        restarted_after_carry = runtime.AdaptiveRecoveryLedger.from_snapshot(
            recovery.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            accepted_results=[exact_result, carried_result],
            dispatch_ledger=restored_dispatch_ledger,
            captured_authority=captured_9,
        )
        self.assertTrue(restarted_after_carry.finding_promotable("timeout-0"))
        tampered_dispatch = json.loads(
            ledger.export_state(authentication_key=self.restart_key)
        )
        tampered_dispatch["payload"]["rows"][carried_result.envelope["dispatch_id"]][
            "state"
        ] = "incomplete"
        with self.assertRaises(runtime.RpfContractError):
            runtime.DispatchLedger.from_state(
                json.dumps(tampered_dispatch).encode(),
                authentication_key=self.restart_key,
                cancellation_provider=runtime.create_os_cancellation_provider(),
                authority=self.full,
            )
        tampered_recovery = json.loads(
            recovery.export_state(authentication_key=self.restart_key)
        )
        tampered_recovery["payload"]["rows"]["timeout-0"]["accepted"] = False
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger.from_snapshot(
                json.dumps(tampered_recovery).encode(),
                authentication_key=self.restart_key,
                accepted_results=[exact_result, carried_result],
                dispatch_ledger=restored_dispatch_ledger,
                captured_authority=captured_9,
            )
        forged_history = json.loads(provider_recovery.snapshot())
        forged_history["rows"]["provider-unit"]["transition_history"][0][
            "dispatch_id"
        ] = "unrelated-terminal"
        forged_history["rows"]["provider-unit"]["pending_replacement_id"] = (
            "unrelated-terminal"
        )
        unrelated = runtime.DispatchLedger(
            runtime.create_os_cancellation_provider(), authority=self.full
        )
        unrelated.start(
            "unrelated-terminal",
            self.limits,
            now=0,
            role_instance="conclusion-blind-persona:security",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=provider_action.obligation_ids,
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger.from_snapshot(
                runtime._encode_authenticated_state(
                    forged_history, authentication_key=self.restart_key
                ),
                authentication_key=self.restart_key,
                dispatch_ledger=unrelated,
                captured_authority=captured,
            )
        forged_recovery = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        with self.assertRaises(runtime.RpfContractError):
            self.record_recovery_failure(
                forged_recovery,
                ledger,
                "forged-unit",
                ["not-captured-authority"],
                "invalid-coverage",
                captured,
            )

    def test_n3_all_reported_barrier_failures_recover_with_exact_evidence(self) -> None:
        recovery = runtime.AdaptiveRecoveryLedger(total_cycles=128)
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        captured = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        authorized_obligation = runtime.coverage_obligations_for_role(
            captured, "conclusion-blind-persona:security"
        )[0][1]
        units = [
            *(f"timeout-{index}" for index in range(7)),
            *(f"coverage-{index}" for index in range(3)),
        ]
        results: list[runtime.ValidatedChildResult] = []
        for unit_id in units:
            obligation = authorized_obligation
            self.record_recovery_failure(
                recovery,
                ledger,
                unit_id,
                [obligation],
                "timed-out" if unit_id.startswith("timeout") else "invalid-coverage",
                captured,
            )
            action = recovery.next_action(unit_id)
            assert action is not None
            ledger.start(
                action.replacement_id,
                self.limits,
                now=0,
                role_instance="conclusion-blind-persona:security",
                cycle=7,
                run_id="run-7",
                fence=self.fence,
                obligation_ids=action.obligation_ids,
                recovery_action=action,
            )
            value = envelope(self.fence, dispatch_id=action.replacement_id)
            value["payload"]["coverage"] = [{
                "obligation_id": obligation,
                "disposition": "verified",
                "evidence": grounded_evidence(
                    captured,
                    "conclusion-blind-persona:security",
                    obligation,
                ),
            }]
            result = self.decode(value)
            ledger.accept(action.replacement_id, result, now=1)
            recovery.accept_exact_coverage(
                unit_id,
                result=result,
                dispatch_ledger=ledger,
                captured_authority=captured,
            )
            results.append(result)
        self.assertEqual((), recovery.unresolved_units())
        restored = runtime.AdaptiveRecoveryLedger.from_snapshot(
            recovery.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            accepted_results=results,
            dispatch_ledger=ledger,
            captured_authority=captured,
        )
        self.assertEqual((), restored.unresolved_units())
        self.assertEqual(
            "recovery-clear",
            restored.run_status(
                completed_cycle=7, goal_gaps=0, dispatch_ledger=ledger
            ),
        )

    def test_o_restricted_transition_uses_static_recovery_after_sanitized_retry(self) -> None:
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        captured = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        obligation = runtime.coverage_obligations_for_role(
            captured, "conclusion-blind-persona:security"
        )[0][1]
        identity = {
            "role_instance": "conclusion-blind-persona:security",
            "cycle": 7,
            "run_id": "run-7",
            "fence": self.fence,
        }
        ledger.start(
            "restricted-1",
            self.limits,
            now=0,
            obligation_ids=[obligation],
            **identity,
        )
        first_envelope = envelope(
                self.fence,
                kind="restricted",
                status="restricted",
                dispatch_id="restricted-1",
            )
        first_envelope["payload"]["obligation_ids"] = [obligation]
        first_result = self.decode(first_envelope)
        ledger.accept("restricted-1", first_result, now=1)
        first = ledger.transition_restricted(
            "restricted-1",
            retry_dispatch_id="restricted-2",
            sanitization_preserves_obligation=True,
        )
        self.assertEqual("sanitized-retry", first.state)
        self.assertTrue(first.retry_allowed)
        ledger = runtime.DispatchLedger.from_state(
            ledger.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            cancellation_provider=runtime.create_os_cancellation_provider(),
            authority=self.full,
        )
        with self.assertRaises(runtime.RpfContractError):
            ledger.start(
                "restricted-2",
                self.limits,
                now=2,
                **identity,
            )
        with self.assertRaises(runtime.RpfContractError):
            ledger.start(
                "restricted-2",
                self.limits,
                now=2,
                retry_of="restricted-1",
                **{**identity, "role_instance": "unrelated-role", "cycle": 8},
            )

        ledger.start(
            "restricted-2",
            self.limits,
            now=2,
            retry_of="restricted-1",
            obligation_ids=[obligation],
            **identity,
        )
        second_envelope = envelope(
                self.fence,
                kind="restricted",
                status="restricted",
                dispatch_id="restricted-2",
            )
        second_envelope["payload"]["obligation_ids"] = [obligation]
        second_result = self.decode(second_envelope)
        ledger.accept("restricted-2", second_result, now=3)
        second = ledger.transition_restricted(
            "restricted-2",
            retry_dispatch_id="restricted-3",
            sanitization_preserves_obligation=True,
        )
        self.assertEqual("controller-static-recovery", second.state)
        self.assertTrue(second.retry_allowed)
        self.assertEqual("continue", second.unrelated_safe_work)
        ledger.start(
            "restricted-3",
            self.limits,
            now=4,
            retry_of="restricted-2",
            obligation_ids=[obligation],
            captured_authority=captured,
            **identity,
        )
        self.assertEqual(
            "controller-static", ledger.snapshot("restricted-3")["execution_kind"]
        )
        with self.assertRaises(runtime.RpfContractError):
            ledger.attach_host(
                "restricted-3", pid=2, child_pid=3, stream=object()
            )
        static_envelope = envelope(self.fence, dispatch_id="restricted-3")
        static_envelope["payload"]["coverage"] = [{
            "obligation_id": obligation,
            "disposition": "verified",
            "evidence": grounded_evidence(
                captured,
                "conclusion-blind-persona:security",
                obligation,
            ),
        }]
        static_result = self.decode(static_envelope)
        ledger.accept("restricted-3", static_result, now=5)
        self.assertEqual((), ledger.unresolved_restricted_obligations())
        restored = runtime.DispatchLedger.from_state(
            ledger.export_state(authentication_key=self.restart_key),
            authentication_key=self.restart_key,
            cancellation_provider=runtime.create_os_cancellation_provider(),
            authority=self.full,
        )
        self.assertEqual((), restored.unresolved_restricted_obligations())

        ledger.start(
            "unsafe-1",
            self.limits,
            now=0,
            obligation_ids=[obligation],
            **identity,
        )
        unsafe_envelope = envelope(
                self.fence,
                kind="restricted",
                status="restricted",
                dispatch_id="unsafe-1",
            )
        unsafe_envelope["payload"]["obligation_ids"] = [obligation]
        unsafe_result = self.decode(unsafe_envelope)
        ledger.accept("unsafe-1", unsafe_result, now=1)
        unsafe = ledger.transition_restricted(
            "unsafe-1",
            retry_dispatch_id="unused",
            sanitization_preserves_obligation=False,
        )
        self.assertEqual("controller-static-recovery", unsafe.state)
        self.assertTrue(unsafe.retry_allowed)
        ledger.start(
            "unused",
            self.limits,
            now=2,
            retry_of="unsafe-1",
            obligation_ids=[obligation],
            captured_authority=captured,
            **identity,
        )
        with self.assertRaises(runtime.RpfContractError):
            ledger.accept(
                "unused",
                self.decode(envelope(
                self.fence,
                kind="restricted",
                status="restricted",
                dispatch_id="unused",
                )),
                now=3,
            )
        self.assertEqual("incomplete", ledger.snapshot("unused")["state"])
        stopped = ledger.transition_restricted(
            "unused",
            retry_dispatch_id="unused-static-2",
            sanitization_preserves_obligation=False,
        )
        self.assertEqual("quarantined", stopped.state)
        self.assertFalse(stopped.retry_allowed)
        with self.assertRaises(runtime.RpfContractError):
            ledger.start(
                "unused-static-2",
                self.limits,
                now=4,
                retry_of="unused",
                obligation_ids=[obligation],
                **identity,
            )

    def test_p_authority_objects_and_decoded_secret_boundaries_resist_forgery(self) -> None:
        forged_authority = dataclasses.replace(self.audit, mode=runtime.FULL_MODE)
        with self.assertRaises(PermissionError):
            runtime.require_mutation_authority(forged_authority, "pointer")
        mutated_authority = runtime.resolve_execution_mode(mutation_authorized=False)
        object.__setattr__(mutated_authority, "mode", runtime.FULL_MODE)
        with self.assertRaises(PermissionError):
            runtime.require_mutation_authority(mutated_authority, "pointer")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "safe.txt"
            path.write_text("safe", encoding="utf-8")
            approved = runtime.classify_path(
                path, repository_root=Path(directory)
            )
            forged_classification = dataclasses.replace(
                approved, sha256=hashlib.sha256(b"safe").hexdigest()
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.read_approved(
                    path,
                    forged_classification,
                    repository_root=Path(directory),
                )
            object.__setattr__(
                approved, "sha256", hashlib.sha256(b"different").hexdigest()
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.read_approved(
                    path, approved, repository_root=Path(directory)
                )

        result = self.decode(envelope(self.fence))
        forged_result = dataclasses.replace(result, raw=b"{}")
        self.assertFalse(runtime.validated_child_result(forged_result))
        object.__setattr__(result, "raw", b"controller-forged")
        self.assertFalse(runtime.validated_child_result(result))

        valid_raw = json.dumps(envelope(self.fence)).encode()
        malformed = (
            valid_raw.replace(b'"kind": "review"', b'"kind": []'),
            valid_raw.replace(
                json.dumps(list(self.fence[1])).encode(), b"null", 1
            ),
            valid_raw.replace(b'"findings": []', b'"findings": [NaN]'),
            valid_raw.replace(
                b'"findings": []',
                b'"findings": ["pass\\u0077ord=credential-material"]',
            ),
        )
        for raw in malformed:
            with self.subTest(raw=raw[:100]), self.assertRaises(runtime.RpfContractError):
                runtime.decode_child_result(
                    raw,
                    finish_reason="stop",
                    limits=self.limits,
                    controller_canary="CONTROLLER-CANARY",
                )
        self.assertTrue(runtime._document_restricted(b'{"password":"abcdefgh"}'))
        self.assertTrue(
            runtime._document_restricted(
                b'prefix\n{"client_secret":"abcdefgh"}'
            )
        )
        deep = b'[' * 1500 + b'0' + b']' * 1500
        with self.assertRaises(runtime.RpfContractError):
            runtime.decode_child_result(
                deep,
                finish_reason="stop",
                limits=self.limits,
                controller_canary="CONTROLLER-CANARY",
            )

    def test_q_repository_bytes_storage_and_pointer_deletion_fail_closed(self) -> None:
        fabricated = {SOURCE_PATH: b"not repository bytes"}
        with self.assertRaises(runtime.RpfConflictError):
            runtime.canonical_fence(
                BASE,
                [SOURCE_PATH],
                runtime.scope_digest((SOURCE_PATH,), fabricated),
                fabricated,
                repository_root=REPO_ROOT,
            )
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory, tempfile.TemporaryDirectory() as outside:
            external = Path(outside) / "source.py"
            external.write_text("external = True\n", encoding="utf-8")
            linked = Path(directory) / "linked"
            linked.symlink_to(Path(outside), target_is_directory=True)
            relative = (linked / "source.py").relative_to(REPO_ROOT).as_posix()
            escaped = {relative: external.read_bytes()}
            with self.assertRaises(runtime.RpfContractError):
                runtime.canonical_fence(
                    BASE,
                    [relative],
                    runtime.scope_digest((relative,), escaped),
                    escaped,
                    repository_root=REPO_ROOT,
                )

        current_root = root_authority(self.fence, self.source)
        candidate_root = dict(current_root)
        candidate_root["pointer_revision"] = 25
        current = pointer_document(
            current_root,
            goal_rows=b"| GAP-1 | open | 1 | gap |\n",
            work_rows=b"| RPF-1 | pending | 1 | task |\n",
        )
        candidate = pointer_document(candidate_root)
        with self.assertRaises(runtime.RpfConflictError):
            runtime.validate_pointer_candidate(current, candidate)
        lower = pointer_document(
            candidate_root,
            goal_rows=b"| GAP-1 | open | 0 | gap |\n",
            work_rows=b"| RPF-1 | pending | 0 | task |\n",
        )
        with self.assertRaises(runtime.RpfConflictError):
            runtime.validate_pointer_candidate(current, lower)
        weakened = copy.deepcopy(candidate_root)
        weakened["completion_criteria"] = []
        with self.assertRaises(runtime.RpfConflictError):
            runtime.validate_pointer_candidate(
                pointer_document(current_root), pointer_document(weakened)
            )

        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            (root / ".context").symlink_to(Path(outside), target_is_directory=True)
            with self.assertRaises((runtime.RpfContractError, OSError)):
                runtime.create_if_absent(
                    root / ".context/rpf.md",
                    pointer_document(current_root),
                    authority=self.full,
                    approved_fence=self.fence,
                    source_bytes=self.source,
                    repository_root=REPO_ROOT,
                )
            self.assertFalse((Path(outside) / "rpf.md").exists())

        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            pointer = Path(directory) / "rpf.md"
            pointer.write_bytes(pointer_document(current_root))
            with self.assertRaises(PermissionError):
                with runtime.acquire_pointer_lock(
                    pointer,
                    "audit-run",
                    authority=self.audit,
                    repository_root=REPO_ROOT,
                ):
                    pass
            artifacts = Path(directory) / "bounded"
            artifacts.mkdir()
            directory_fd = os.open(artifacts, os.O_RDONLY)
            try:
                (artifacts / "link.bin").symlink_to(pointer)
                with self.assertRaises(OSError):
                    runtime._read_at(directory_fd, "link.bin", max_bytes=100)
                fifo = artifacts / "pipe.bin"
                os.mkfifo(fifo)
                with self.assertRaises(runtime.RpfContractError):
                    runtime._read_at(directory_fd, "pipe.bin", max_bytes=100)
                (artifacts / "large.bin").write_bytes(b"x" * 101)
                with self.assertRaises(runtime.RpfContractError):
                    runtime._read_at(directory_fd, "large.bin", max_bytes=100)
            finally:
                os.close(directory_fd)

    def test_r_topology_ui_persona_watch_and_risk_authority_are_derived(self) -> None:
        game_source = {
            **self.source,
            GAME_PROJECT_PATH: (REPO_ROOT / GAME_PROJECT_PATH).read_bytes(),
            GAME_SCENE_PATH: (REPO_ROOT / GAME_SCENE_PATH).read_bytes(),
        }
        topology = runtime.derive_game_topology(game_source)
        self.assertIn(
            "agents/rpf/tests/fixtures/missing.shader",
            topology["assets"]["frontier"],
        )
        mapping = runtime.derive_ui_mapping(
            {
                "ShareScreen.tsx": b'<div onClick={share} aria-label="share" style={{overflow:"auto"}} />',
                "SettingsScreen.tsx": b'<div onClick={save} aria-label="save" style={{overflow:"auto"}} />',
            }
        )
        self.assertEqual(12, len(mapping))
        one_surface = runtime.derive_ui_mapping(
            {"Screen.tsx": b'<div aria-label="one" />'}
        )
        two_surfaces = runtime.derive_ui_mapping(
            {"Screen.tsx": b'<div aria-label="one" />\n<button>two</button>'}
        )
        self.assertGreater(len(two_surfaces), len(one_surface))

        invented = root_authority(self.fence, self.source)
        invented["selected_personas"] = ["invented"]
        invented["aggregate_claims"] = {
            key: value
            for key, value in invented["aggregate_claims"].items()
            if not value["role_instance"].startswith("conclusion-blind-persona:")
        }
        invented["aggregate_claims"]["claim:invented"] = {
            "role_instance": "conclusion-blind-persona:invented",
            "claim": "invented lens",
            "refs": [{"path": SOURCE_PATH, "line": 1, "symbol": "producer"}],
        }
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(invented), self.fence, self.source, REPO_ROOT
            )
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(
                    root_authority(self.fence, self.source),
                    feedback_rows=b"| FB-ORPHAN | review | 7 | fix | RPF-999 |\n",
                ),
                self.fence,
                self.source,
                REPO_ROOT,
            )
        feedback_text = "critical auth fix"
        feedback_digest = hashlib.sha256(feedback_text.encode()).hexdigest()
        feedback_row = (
            f"| FB-BOUND | review | 7 | {feedback_text} | RPF-9 |\n".encode()
        )
        bound_task = f"feedback-link:FB-BOUND:{feedback_digest}"
        promoted = root_authority(self.fence, self.source)
        promoted["convergence_state"]["open_work_ids"] = ["RPF-9"]
        self.assertTrue(runtime.captured_authority_valid(
            runtime.capture_authority(
                pointer_document(
                    promoted,
                    work_rows=f"| RPF-9 | pending | 1 | {bound_task} |\n".encode(),
                    feedback_rows=feedback_row,
                ),
                self.fence,
                self.source,
                REPO_ROOT,
            )
        ))
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(
                    root_authority(self.fence, self.source),
                    work_rows=f"| RPF-9 | done | 1 | {bound_task} |\n".encode(),
                    feedback_rows=feedback_row,
                ),
                self.fence,
                self.source,
                REPO_ROOT,
            )

        stale_cleared = [{
            "id": "RW-1",
            "rev": 1,
            "status": "cleared",
            "changed_cycle": 6,
            "fence": (BASE, self.fence[1], "f" * 64),
            "obligation": "save contract",
            "evidence": ["validated-result:old-result"],
            "clearance_result_id": "old-result",
            "cleared_cycle": 6,
        }]
        reopened = runtime.carry_open_watches(
            stale_cleared, self.fence, current_cycle=7
        )
        self.assertEqual("open", reopened[0]["status"])
        self.assertIsNone(reopened[0]["clearance_result_id"])
        forged_clearance = [{
            **stale_cleared[0],
            "fence": self.fence,
            "cleared_cycle": 7,
            "clearance_result_id": "never-issued",
            "evidence": ["validated-result:never-issued"],
        }]
        with self.assertRaises(runtime.RpfContractError):
            runtime.carry_open_watches(
                forged_clearance,
                self.fence,
                current_cycle=7,
                current_run_id="run-7",
            )

        risk_root = root_authority(self.fence, self.source)
        risk_root["residual_risks"] = [{
            "id": "RISK-1",
            "risk": "runtime prohibited",
            "verification_status": "runtime-unverified-prohibited",
            "affected_contract_ids": ["SC-1"],
            "ui_ids": [],
        }]
        with self.assertRaises(runtime.RpfContractError):
            runtime.register_user_authority_provider(
                provider_id="conversation-host",
                confirmer_id="conversation-confirmer",
                observer_id="conversation-observer",
                confirm=HostAdapter(lambda _: {}).invoke,
                observe=HostAdapter(lambda _: {}).invoke,
                authority=self.full,
            )
        risk_root["risk_acceptance"] = [{
            "residual_risk_id": "RISK-1",
            "authorization_id": "caller-authored",
            "scope": "this invocation",
            "rationale": "explicitly accepted",
        }]
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(risk_root), self.fence, self.source, REPO_ROOT
            )

    def test_r_equal_revision_nonidentical_authority_blocks_without_loss(self) -> None:
        left = {"id": "RPF-9", "rev": 21, "status": "pending", "acceptance": ["A"]}
        right = {
            "id": "RPF-9",
            "rev": 21,
            "status": "done",
            "acceptance": ["A", "backup invariant"],
        }
        with self.assertRaises(runtime.RpfConflictError):
            runtime.merge_revisioned_authority([left, right])
        self.assertEqual(
            [left], runtime.merge_revisioned_authority([left, dict(left)])
        )
        higher = {**right, "rev": 22}
        self.assertEqual(
            higher, runtime.merge_revisioned_authority([left, higher])[0]
        )

        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            pointer = Path(directory) / ".context" / "rpf.md"
            pointer.parent.mkdir()
            root = root_authority(self.fence, self.source)
            base_document = pointer_document(
                root,
                goal_rows=b"| GAP-9 | open | 24 | preserve recovery obligation |\n",
                work_rows=b"| RPF-9 | pending | 24 | acceptance A |\n",
            )
            pointer.write_bytes(base_document)
            candidate_root = dict(root)
            candidate_root["pointer_revision"] = 25
            publication_contract = {
                "authority": self.full,
                "run_id": "run-7",
                "approved_fence": self.fence,
                "source_bytes": self.source,
                "repository_root": REPO_ROOT,
            }
            candidates = (
                pointer_document(
                    candidate_root,
                    goal_rows=b"| GAP-9 | open | 24 | preserve recovery obligation |\n",
                    work_rows=b"| RPF-9 | pending | 24 | acceptance B |\n",
                ),
                pointer_document(
                    candidate_root,
                    goal_rows=b"| GAP-9 | open | 24 | preserve recovery obligation |\n",
                    work_rows=b"| RPF-9 | done | 24 | acceptance A |\n",
                ),
                pointer_document(
                    candidate_root,
                    goal_rows=b"| GAP-9 | open | 24 | silently changed obligation |\n",
                    work_rows=b"| RPF-9 | pending | 24 | acceptance A |\n",
                ),
            )
            for candidate in candidates:
                with self.subTest(candidate=candidate[-80:]):
                    result = runtime.publish_if_exact(
                        pointer,
                        runtime.observe_snapshot(pointer),
                        candidate,
                        **publication_contract,
                    )
                    self.assertEqual("reconcile-required", result.status)
                    self.assertEqual(base_document, pointer.read_bytes())
                    preserved = {
                        Path(path).read_bytes()
                        for path in result.recovery_paths
                        if path.endswith(".bin")
                    }
                    self.assertIn(base_document, preserved)
                    self.assertIn(candidate, preserved)

    def test_s_security_boundaries_reject_indirect_disclosure_and_self_attestation(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory, tempfile.TemporaryDirectory() as outside:
            local = Path(directory)
            external = Path(outside) / "plain.txt"
            external.write_text("outside", encoding="utf-8")
            (local / "link").symlink_to(Path(outside), target_is_directory=True)
            escaped = runtime.classify_path(
                local / "link" / "plain.txt", repository_root=REPO_ROOT
            )
            self.assertEqual("uninspectable", escaped.disposition)

            cfg = local / "cfg"
            cfg.mkdir()
            (cfg / "credentials.txt").write_text(
                "FAKE_SAFE_MARKER", encoding="utf-8"
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.safe_command_preflight(
                    ["rg", "FAKE_SAFE_MARKER", os.fspath(cfg.relative_to(REPO_ROOT))],
                    repository_root=REPO_ROOT,
                )
            (cfg / "config.txt").write_text(
                "OPAQUE-SENSITIVE-VALUE", encoding="utf-8"
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.safe_command_preflight(
                    ["rg", "OPAQUE", os.fspath(cfg.relative_to(REPO_ROOT))],
                    repository_root=REPO_ROOT,
                )
            with self.assertRaises(runtime.RpfContractError):
                runtime.safe_command_preflight(
                    ["rg", "outside", os.fspath((local / "link" / "plain.txt").relative_to(REPO_ROOT))],
                    repository_root=REPO_ROOT,
                )
            for command in (
                ["python3", "-c", "print(__import__('os').environ)"],
                ["ruby", "-e", "puts ENV"],
            ):
                with self.assertRaises(runtime.RpfContractError):
                    runtime.safe_command_preflight(
                        command, repository_root=REPO_ROOT
                    )
            script = local / "safe_probe.py"
            script.write_text("print('never executed')\n", encoding="utf-8")
            script_approval = runtime.classify_path(script, repository_root=REPO_ROOT)
            with mock.patch.dict(
                os.environ,
                {
                    "RPF_CANARY": "opaque-value",
                    "PATH": "/tmp/OPAQUE-HOST-CANARY:/usr/bin:/bin",
                },
            ):
                with self.assertRaises(runtime.RpfContractError):
                    runtime.run_safe_command(
                        [sys.executable, os.fspath(script.relative_to(REPO_ROOT))],
                        repository_root=REPO_ROOT,
                        approved_inputs=[script_approval],
                    )

        escaped_note = b'notes: {"pass\\u0077ord":"abcdefgh"}'
        self.assertTrue(runtime._document_restricted(escaped_note))
        record = {"id": "RR-1", "value": "observed"}
        with self.assertRaises(runtime.RpfContractError):
            runtime.register_runtime_evidence_provider(
                provider_id="self",
                executor_id="caller-executor",
                observer_id="caller-observer",
                execute=HostAdapter(lambda _: {}).invoke,
                observe=HostAdapter(lambda _: {}).invoke,
                authority=self.full,
            )
        direct = runtime.RuntimeEvidenceProvider(
            "self", "same", "same", lambda _: {}, lambda _: {}
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.issue_runtime_receipt(record, direct)
        executable = Path(tempfile.gettempdir()) / "rpf-opaque-executable"
        executable.write_text("#!/bin/sh\necho should-not-run\n", encoding="utf-8")
        executable.chmod(0o700)
        try:
            with mock.patch.dict(
                os.environ,
                {"PATH": f"{executable.parent}:/usr/bin:/bin"},
            ), self.assertRaises(runtime.RpfContractError):
                runtime.run_safe_command(
                    [executable.name], repository_root=REPO_ROOT
                )
        finally:
            executable.unlink(missing_ok=True)

        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            recovery_dir = Path(directory) / "recovery"
            recovery_dir.mkdir()
            with mock.patch.object(
                runtime, "_directory_matches_fd", side_effect=[True, False]
            ), self.assertRaises(runtime.RpfConflictError):
                runtime._preserve_reconciliation(
                    recovery_dir,
                    repository_root=REPO_ROOT,
                    base=b"base",
                    current=b"current",
                    candidate=b"candidate",
                    reason="directory-change-test",
                )

    def test_t_recovery_authority_is_exact_unique_and_cycle_bounded(self) -> None:
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger(total_cycles=129)
        captured = runtime.capture_authority(
            pointer_document(root_authority(self.fence, self.source)),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        authorized = runtime.coverage_obligations_for_role(
            captured, "conclusion-blind-persona:security"
        )[0][1]
        recovery = runtime.AdaptiveRecoveryLedger(total_cycles=3, start_cycle=7)
        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        self.record_recovery_failure(
            recovery,
            ledger,
            "unit-1",
            [authorized],
            "timed-out",
            captured,
        )
        with self.assertRaises(runtime.RpfContractError):
            recovery.record_failure(
                "duplicate-original-dispatch",
                obligation_ids=[authorized],
                failure_kind="timed-out",
                cycle=7,
                failed_dispatch_id="failed-unit-1",
                dispatch_ledger=ledger,
                captured_authority=captured,
            )
        attacker = runtime.DispatchLedger(self.cancellation, authority=self.full)
        attacker.start(
            "attacker-initial",
            self.limits,
            now=0,
            role_instance="attacker",
            cycle=7,
            run_id="evil-run",
            fence=(self.fence[0], self.fence[1], "f" * 64),
            obligation_ids=[authorized],
        )
        self.attach_host(attacker, "attacker-initial")
        attacker.expire("attacker-initial", now=31)
        with self.assertRaises(runtime.RpfContractError):
            runtime.AdaptiveRecoveryLedger(total_cycles=3, start_cycle=7).record_failure(
                "attacker-unit",
                obligation_ids=[authorized],
                failure_kind="timed-out",
                cycle=7,
                failed_dispatch_id="attacker-initial",
                dispatch_ledger=attacker,
                captured_authority=captured,
            )
        switched = runtime.AdaptiveRecoveryLedger(total_cycles=3, start_cycle=7)
        switched_ledger = runtime.DispatchLedger(
            self.cancellation, authority=self.full
        )
        self.record_recovery_failure(
            switched,
            switched_ledger,
            "role-switch",
            [authorized],
            "timed-out",
            captured,
        )
        switched_action = switched.next_action("role-switch")
        assert switched_action is not None
        with self.assertRaises(runtime.RpfContractError):
            switched_ledger.start(
                switched_action.replacement_id,
                self.limits,
                now=0,
                role_instance="conclusion-blind-persona:testing",
                cycle=7,
                run_id="run-7",
                fence=self.fence,
                obligation_ids=switched_action.obligation_ids,
                recovery_action=switched_action,
            )
        self.assertEqual(
            switched_action,
            switched.next_action("role-switch"),
        )
        action = recovery.next_action("unit-1")
        assert action is not None
        with self.assertRaises(runtime.RpfContractError):
            ledger.start(
                action.replacement_id,
                self.limits,
                now=0,
                role_instance="conclusion-blind-persona:security",
                cycle=99,
                run_id="other-run",
                fence=self.fence,
                obligation_ids=action.obligation_ids,
                recovery_action=action,
            )

        for _ in range(3):
            current = recovery.next_action("unit-1")
            if current is None:
                break
            good = runtime.DispatchLedger(
                runtime.create_os_cancellation_provider(), authority=self.full
            )
            static = current.strategy == "controller-static-review"
            good.start(
                current.replacement_id,
                self.limits,
                now=0,
                role_instance="conclusion-blind-persona:security",
                cycle=7,
                run_id="run-7",
                fence=self.fence,
                obligation_ids=current.obligation_ids,
                recovery_action=current,
                captured_authority=captured if static else None,
            )
            if static:
                failed = envelope(
                    self.fence,
                    kind="incomplete",
                    status="incomplete",
                    dispatch_id=current.replacement_id,
                )
                failed["payload"]["obligation_ids"] = list(
                    current.obligation_ids
                )
                good.accept(current.replacement_id, self.decode(failed), now=1)
            else:
                self.attach_host(good, current.replacement_id)
                good.expire(current.replacement_id, now=31)
            recovery.record_replacement_failure(
                "unit-1",
                replacement_id=current.replacement_id,
                dispatch_ledger=good,
                captured_authority=captured,
            )
        with self.assertRaises(runtime.RpfContractError):
            recovery.carry_to_cycle("unit-1", cycle=9)

    def test_u_contract_ui_game_and_watch_counterexamples_are_closed(self) -> None:
        false_clean = root_authority(self.fence, self.source)
        false_clean["contracts"] = {}
        false_clean["gate_results"] = [{
            "id": "GATE-NONE",
            "classification": "not-applicable",
            "affected_contract_ids": [],
            "fence": self.fence,
        }]
        false_clean["test_prohibitions"] = []
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(false_clean), self.fence, self.source, REPO_ROOT
            )
        projected_root = root_authority(self.fence, self.source)
        projected_pointer = pointer_document(
            projected_root,
            work_rows=b"| RPF-77 | pending | 1 | unresolved task |\n",
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                projected_pointer, self.fence, self.source, REPO_ROOT
            )
        case_variant = pointer_document(
            root_authority(self.fence, self.source),
            work_rows=b"| RPF-78 | Pending | 1 | unresolved task |\n",
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                case_variant, self.fence, self.source, REPO_ROOT
            )
        projected_root["convergence_state"]["open_work_ids"] = ["RPF-77"]
        self.assertTrue(
            runtime.captured_authority_valid(
                runtime.capture_authority(
                    pointer_document(
                        projected_root,
                        work_rows=b"| RPF-77 | pending | 1 | unresolved task |\n",
                    ),
                    self.fence,
                    self.source,
                    REPO_ROOT,
                )
            )
        )
        peer_capture = runtime.capture_authority(
            pointer_document(
                root_authority(self.fence, self.source),
                active_run_rows=b"| peer-run | rpf | 7 | review |\n",
            ),
            self.fence,
            self.source,
            REPO_ROOT,
        )
        self.assertEqual(("peer-run",), peer_capture["active_peer_ids"])
        for field, rows in (
            (
                "open_reconciliation_ids",
                {"reconciliation_rows": b"| REC-1 | open | 1 | pointer |\n"},
            ),
            (
                "open_secret_incident_ids",
                {"secret_rows": b"| SEC-1 | open | 1 | tool-output |\n"},
            ),
        ):
            omitted = root_authority(self.fence, self.source)
            with self.subTest(convergence_field=field), self.assertRaises(
                runtime.RpfContractError
            ):
                runtime.capture_authority(
                    pointer_document(omitted, **rows),
                    self.fence,
                    self.source,
                    REPO_ROOT,
                )
            omitted["convergence_state"][field] = [
                "REC-1" if field == "open_reconciliation_ids" else "SEC-1"
            ]
            self.assertTrue(runtime.captured_authority_valid(
                runtime.capture_authority(
                    pointer_document(omitted, **rows),
                    self.fence,
                    self.source,
                    REPO_ROOT,
                )
            ))
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(
                    root_authority(self.fence, self.source),
                    feedback_rows=b"| FB-1 | review | 7 | fix | pending |\n",
                ),
                self.fence,
                self.source,
                REPO_ROOT,
            )

        root = root_authority(self.fence, self.source)
        root["test_prohibitions"][0]["command"] = "nit"
        root["test_prohibitions"][0]["source_ref"]["command_sha256"] = hashlib.sha256(
            b"nit"
        ).hexdigest()
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(root), self.fence, self.source, REPO_ROOT
            )
        keyword_root = root_authority(self.fence, self.source)
        keyword_root["test_prohibitions"][0]["command"] = "def"
        keyword_root["test_prohibitions"][0]["source_ref"]["command_sha256"] = (
            hashlib.sha256(b"def").hexdigest()
        )
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(keyword_root), self.fence, self.source, REPO_ROOT
            )
        wrong_symbol = root_authority(self.fence, self.source)
        wrong_symbol["test_prohibitions"][0]["source_ref"]["symbol"] = "unit"
        with self.assertRaises(runtime.RpfContractError):
            runtime.capture_authority(
                pointer_document(wrong_symbol), self.fence, self.source, REPO_ROOT
            )

        prose_incidents = runtime.derive_incident_coverage({
            "notes.txt": (
                b"state write json email auth default session logout lock "
                b"chat final save error backup restore schema mobile overflow aria-"
            )
        })
        self.assertFalse(any(row["applicable"] for row in prose_incidents.values()))
        constant_incidents = runtime.derive_incident_coverage({
            "labels.py": b"\n".join([
                b'STATE_LABEL = "state"', b'WRITE_LABEL = "write"',
                b'JSON_LABEL = "json"', b'EMAIL_LABEL = "email"',
                b'AUTH_LABEL = "auth"', b'DEFAULT_LABEL = "default"',
                b'SESSION_LABEL = "session"', b'LOCK_LABEL = "lock"',
                b'CHAT_LABEL = "chat"', b'FINAL_LABEL = "final"',
                b'SAVE_LABEL = "save"', b'ERROR_LABEL = "error"',
                b'BACKUP_LABEL = "backup"', b'RESTORE_LABEL = "restore"',
                b'SCHEMA_LABEL = "schema"', b'MOBILE_LABEL = "mobile"',
                b'OVERFLOW_LABEL = "overflow"', b'ARIA_LABEL = "aria-"',
            ])
        })
        self.assertFalse(any(
            row["applicable"] for row in constant_incidents.values()
        ))
        parameter_incidents = runtime.derive_incident_coverage({
            "names.py": b"\n".join([
                b"def a(state, write, json): return 1",
                b"def b(email, auth, default): return 1",
                b"def c(session, logout, lock): return 1",
                b"def d(chat, final, save, error): return 1",
                b"def e(backup, restore, schema): return 1",
                b"def f(mobile, overflow, accessibility): return 1",
            ])
        })
        self.assertFalse(any(
            row["applicable"] for row in parameter_incidents.values()
        ))

        duplicate_surfaces = runtime.derive_ui_mapping(
            {"Screen.tsx": b'<div aria-label="x"/><div aria-label="x"/>'}
        )
        self.assertEqual(12, len(duplicate_surfaces))
        game_source = {
            GAME_PROJECT_PATH: (REPO_ROOT / GAME_PROJECT_PATH).read_bytes(),
            GAME_SCENE_PATH: b'[node]\nresource = "res://models/missing.glb"\n',
            "logic.gd": b'var item = preload("hidden/missing.shader")\n',
        }
        topology = runtime.derive_game_topology(game_source)
        self.assertIn("models/missing.glb", topology["assets"]["frontier"])
        self.assertIn("hidden/missing.shader", topology["lifecycle"]["frontier"])
        binary_topology = runtime.derive_game_topology({
            GAME_PROJECT_PATH: (REPO_ROOT / GAME_PROJECT_PATH).read_bytes(),
            "model.glb": b"\xff\x00\xfe\x01",
        })
        self.assertEqual(2, binary_topology["assets"]["node_count"])
        self.assertIn(
            "uninspectable-binary:model.glb",
            binary_topology["assets"]["frontier"],
        )
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as game_directory:
            game_root = Path(game_directory)
            (game_root / "project.godot").write_text(
                '[application]\nrun/main_scene="res://main.tscn"\n',
                encoding="utf-8",
            )
            (game_root / "main.gd").write_text("extends Node\n", encoding="utf-8")
            (game_root / "model.glb").write_bytes(b"model")
            script_path = (game_root / "main.gd").relative_to(REPO_ROOT).as_posix()
            discovered = runtime.required_game_inventory_paths(
                {script_path: (game_root / "main.gd").read_bytes()}, REPO_ROOT
            )
            self.assertIn(
                (game_root / "project.godot").relative_to(REPO_ROOT).as_posix(),
                discovered,
            )
            self.assertIn(
                (game_root / "model.glb").relative_to(REPO_ROOT).as_posix(),
                discovered,
            )
            audit_source = {script_path: (game_root / "main.gd").read_bytes()}
            audit_fence = runtime.canonical_fence(
                BASE,
                (script_path,),
                runtime.scope_digest((script_path,), audit_source),
                audit_source,
                repository_root=REPO_ROOT,
            )
            with self.assertRaises(runtime.RpfContractError):
                runtime.capture_audit_authority(
                    audit_fence,
                    audit_source,
                    REPO_ROOT,
                    run_id="audit-game-scope",
                    dispatch_ledger=runtime.DispatchLedger(
                        runtime.create_os_cancellation_provider(),
                        authority=self.audit,
                    ),
                )

        ledger = runtime.DispatchLedger(self.cancellation, authority=self.full)
        ledger.start(
            "regression-result",
            self.limits,
            now=0,
            role_instance="regression-falsifier",
            cycle=7,
            run_id="run-7",
            fence=self.fence,
            obligation_ids=["RW-1"],
        )
        value = {
            "protocol_version": runtime.PROTOCOL_VERSION,
            "kind": "regression",
            "status": "passed",
            "role_instance": "regression-falsifier",
            "cycle": 7,
            "run_id": "run-7",
            "dispatch_id": "regression-result",
            "fence": {
                "base": self.fence[0],
                "scope": list(self.fence[1]),
                "hash": self.fence[2],
            },
            "payload": {
                "verdicts": [],
                "coverage": [{
                    "obligation_id": "RW-1",
                    "disposition": "verified",
                    "evidence": ["watch:RW-1"],
                }],
                "residual_risks": [],
            },
        }
        result = self.decode(value)
        ledger.accept("regression-result", result, now=1)
        cleared = [{
            "id": "RW-1",
            "rev": 2,
            "status": "cleared",
            "changed_cycle": 6,
            "fence": self.fence,
            "obligation": "save contract",
            "evidence": ["validated-result:regression-result"],
            "clearance_result_id": "regression-result",
            "cleared_cycle": 7,
        }]
        with self.assertRaises(runtime.RpfContractError):
            runtime.carry_open_watches(
                cleared,
                self.fence,
                current_cycle=7,
                current_run_id="run-7",
                validated_results=[result],
                dispatch_ledger=ledger,
            )
        with self.assertRaises(runtime.RpfContractError):
            runtime.carry_open_watches(
                [{**cleared[0], "changed_cycle": 7}],
                self.fence,
                current_cycle=7,
                current_run_id="run-7",
                validated_results=[result],
                dispatch_ledger=ledger,
            )

    def test_v_publish_readback_mismatch_preserves_displaced_inode(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            pointer = Path(directory) / "pointer.md"
            current_root = root_authority(self.fence, self.source)
            current_root["pointer_revision"] = 30
            current = pointer_document(current_root)
            pointer.write_bytes(current)
            candidate_root = root_authority(self.fence, self.source)
            candidate_root["pointer_revision"] = 31
            candidate = pointer_document(candidate_root)
            expected = runtime.observe_snapshot(pointer)
            native_observe = runtime._observe_at
            native_write = runtime._write_private_at
            observations = 0
            temporary_names: list[str] = []

            def observe_temp_name(directory_fd: int, name: str, data: bytes) -> None:
                if name.startswith(".rpf."):
                    temporary_names.append(name)
                native_write(directory_fd, name, data)

            def mismatched_readback(directory_fd: int, name: str) -> object:
                nonlocal observations
                observations += 1
                observed = native_observe(directory_fd, name)
                if observations == 3:
                    fake = b"different-readback"
                    return dataclasses.replace(
                        observed,
                        identity=dataclasses.replace(
                            observed.identity,
                            sha256=hashlib.sha256(fake).hexdigest(),
                            size=len(fake),
                        ),
                        data=fake,
                    )
                return observed

            displaced_fd = os.open(pointer, os.O_RDWR)
            try:
                with mock.patch.object(
                    runtime, "atomic_exchange_available", return_value=True
                ), mock.patch.object(
                    runtime, "_observe_at", side_effect=mismatched_readback
                ), mock.patch.object(
                    runtime, "_write_private_at", side_effect=observe_temp_name
                ):
                    outcome = runtime.publish_if_exact(
                        pointer,
                        expected,
                        candidate,
                        authority=self.full,
                        run_id="run-7",
                        approved_fence=self.fence,
                        source_bytes=self.source,
                        repository_root=REPO_ROOT,
                    )
                marker = b"\nretained-open-inode-marker\n"
                os.lseek(displaced_fd, 0, os.SEEK_END)
                os.write(displaced_fd, marker)
                os.fsync(displaced_fd)
            finally:
                os.close(displaced_fd)
            self.assertEqual("reconcile-required", outcome.status)
            self.assertEqual(1, len(temporary_names))
            self.assertRegex(
                temporary_names[0], r"^\.rpf\.pointer\.md\.[0-9a-f]{32}\.tmp$"
            )
            retained = [
                Path(path) for path in outcome.recovery_paths
                if Path(path).name.startswith("readback-mismatch-displaced-live-")
            ]
            self.assertEqual(1, len(retained))
            self.assertEqual(current + marker, retained[0].read_bytes())


class RpfUiMarkerScopeTest(unittest.TestCase):
    """`router` and `navigate` must name UI code, not any prose containing them.

    As bare substrings they claimed six unverifiable UI obligations for a
    Markdown table documenting a CLI subcommand named `navigate`, and twelve
    more for a `router_commands()` helper registering CLI verbs. Neither file
    renders anything, so the obligations could never be discharged.
    """

    REAL_UI_USAGES = (
        b'router.push("/a")',
        b'const r = useRouter()',
        b'const r = use_router()',
        b'createRouter({})',
        b'<router-link to="/a"/>',
        b'<RouterView/>',
        b'this.router.navigate(["/a"])',
        b'navigate("/home")',
        b'const n = useNavigate()',
        b'navigateTo("/a")',
    )

    NON_UI_MENTIONS = (
        b'| `navigate` | `nav` | Load a URL and report the final page |',
        b'npm run pw -- navigate https://example.com --wait networkidle',
        b'# Flags handled by the router itself rather than by a command.',
        b'def router_commands() -> dict[str, str]:\n    return {}\n',
        b'See the navigation guide for how to navigate the archive.',
    )

    def test_router_and_navigate_usage_is_still_a_ui_surface(self) -> None:
        for source in self.REAL_UI_USAGES:
            with self.subTest(source=source):
                mapping = runtime.derive_ui_mapping({"view.ts": source})
                self.assertEqual(len(runtime.UI_KINDS), len(mapping))

    def test_router_and_navigate_prose_is_not_a_ui_surface(self) -> None:
        for source in self.NON_UI_MENTIONS:
            with self.subTest(source=source):
                self.assertEqual(
                    {}, dict(runtime.derive_ui_mapping({"doc.md": source}))
                )

    def test_unambiguous_markup_still_wins_regardless_of_suffix(self) -> None:
        """Narrowing two words must not narrow the markup markers."""
        for source in (
            b'<div aria-label="x"/>',
            b'<button onclick="go()">go</button>',
            b'@media (max-width: 40em) { .a { overflow: auto } }',
            b'<meta name="viewport" content="width=device-width">',
            b'def view(): return render_template("a.html")',
        ):
            with self.subTest(source=source):
                self.assertEqual(
                    len(runtime.UI_KINDS),
                    len(runtime.derive_ui_mapping({"page.md": source})),
                )

    def test_the_repository_ui_surface_is_still_detected(self) -> None:
        """The guard against narrowing coverage to make a gap count fall."""
        canvas = "agents/air-workbench/ui/graph-canvas.jsx"
        mapping = runtime.derive_ui_mapping(
            {canvas: (REPO_ROOT / canvas).read_bytes()}
        )
        self.assertGreaterEqual(len(mapping), 6 * len(runtime.UI_KINDS))
        fixture = runtime.derive_ui_mapping(
            {UI_SOURCE_PATH: (REPO_ROOT / UI_SOURCE_PATH).read_bytes()}
        )
        self.assertEqual(2 * len(runtime.UI_KINDS), len(fixture))


class LiteralBracketScopeTest(unittest.TestCase):
    def test_literal_bracket_route_path_is_a_valid_exact_scope_member(self) -> None:
        # Expo Router-style dynamic-route filenames are literal paths: "[" and
        # "]" must not be rejected as glob metacharacters in an exact scope.
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as directory:
            route = Path(directory) / "[id].tsx"
            route.write_text("export default null;\n", encoding="utf-8")
            relative = route.relative_to(REPO_ROOT).as_posix()
            source = {relative: route.read_bytes()}
            digest = runtime.scope_digest((relative,), source)
            fence = runtime.canonical_fence(
                BASE, [relative], digest, source, repository_root=REPO_ROOT
            )
            self.assertEqual((BASE, (relative,), digest), fence)

    def test_glob_expansion_metacharacters_remain_rejected(self) -> None:
        for bad in ("app/*.tsx", "app/?.tsx"):
            with self.assertRaises(runtime.RpfContractError):
                runtime.scope_digest((bad,), {bad: b""})


class FrozenVerdictClearanceTest(unittest.TestCase):
    def test_frozen_regression_verdict_evidence_tuple_is_accepted(self) -> None:
        # _freeze_json turns JSON arrays into tuples; the carry-time verdict
        # evidence check must accept that frozen form (it previously required
        # a list, making watch clearance impossible for any sealed result).
        self.assertTrue(runtime._string_sequence(("watch:WATCH-1",)))
        self.assertTrue(runtime._string_sequence(["watch:WATCH-1"]))
        self.assertFalse(runtime._string_sequence(()))
        self.assertFalse(runtime._string_sequence(("", )))
        self.assertFalse(runtime._string_sequence("watch:WATCH-1"))


if __name__ == "__main__":
    unittest.main()
