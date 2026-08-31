"""Documentation conformance models.

Production authority is reconstructed and sealed only by ``rpf_runtime``.
These pure reducers model Markdown contracts and must not be imported by an RPF
controller as an authority or publication path.

Some legacy rendering models retain numeric ``COV-*`` row IDs to exercise old
pointer migration. Production dispatch and reduction use the exact semantic
obligation inventory in ``rpf_runtime.DispatchLedger``.
"""

import ast
import hashlib
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import rpf_runtime as runtime  # noqa: E402


SOURCE_PATH = "agents/rpf/tests/fixtures/source_fixture.py"
LEGACY_SOURCE_BYTES = {
    SOURCE_PATH: (REPO_ROOT / SOURCE_PATH).read_bytes()
}
VALID_FENCE = (
    subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
    ).strip(),
    (SOURCE_PATH,),
    runtime.scope_digest((SOURCE_PATH,), LEGACY_SOURCE_BYTES),
)
OTHER_FENCE = ("c" * 40, (SOURCE_PATH,), "d" * 64)
LEGACY_SOURCE_INDEX = runtime.build_source_index(LEGACY_SOURCE_BYTES)

GAME_FAMILIES = (
    "lifecycle", "scenes", "assets", "input", "state", "physics/AI",
    "combat", "economy/progression", "save/load", "network", "UI",
    "platform variants",
)
INCIDENT_FAMILIES = (
    "state-file-corruption-overwrite", "email-only-auth-default",
    "session-teardown-concurrency-loss", "chat-final-save-truthfulness",
    "backup-restore-equivalence", "mobile-clipping-accessibility",
)
RPF_SOURCE_SURFACES = (
    "agents/rpf/SKILL.md",
    "agents/rpf/agents/openai.yaml",
    "agents/rpf/assets/pointer-template.md",
    "agents/rpf/references/concurrency.md",
    "agents/rpf/references/detection.md",
    "agents/rpf/references/orchestration.md",
    "agents/rpf/references/persona-lenses.md",
    "agents/rpf/references/review-verification.md",
    "agents/rpf/references/runtime-contract.md",
    "agents/rpf/references/technical-recovery.md",
    "agents/rpf/scripts/rpf_bootstrap.py",
    "agents/rpf/scripts/rpf_rescue.py",
    "agents/rpf/scripts/rpf_runtime.py",
    "agents/rpf/tests/test_rpf_bootstrap.py",
    "agents/rpf/tests/test_rpf_contract.py",
    "agents/rpf/tests/test_rpf_runtime.py",
)
CORE_REQUIRED_ROLES = {
    "conclusion-blind-persona:security",
    "conclusion-blind-persona:testing",
    "pointer-alignment",
    "plan-doc-consistency",
    "aggregate-result-falsifier",
}


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def section(text: str, heading: str) -> str:
    match = re.search(
        rf"^## {re.escape(heading)}\n(?P<body>.*?)(?=^## |\Z)",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not match:
        raise AssertionError(f"missing section: {heading}")
    return match.group("body")


def normalize(text: str) -> str:
    return " ".join(text.split())


def ordered(text: str, *needles: str) -> bool:
    haystack = normalize(text)
    positions = [haystack.find(normalize(needle)) for needle in needles]
    return all(position >= 0 for position in positions) and positions == sorted(positions)


def fenced_json(text: str) -> dict[str, object]:
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if not match:
        raise AssertionError("missing fenced JSON contract")
    value = json.loads(match.group(1))
    if not isinstance(value, dict):
        raise AssertionError("JSON contract is not an object")
    return value


def runtime_function(name: str) -> ast.FunctionDef:
    """Locate a runtime function so a doc claim is checked against real code."""

    tree = ast.parse((ROOT / "scripts" / "rpf_runtime.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"missing runtime function: {name}")


def evidence_token_prefixes() -> set[str]:
    """The literal token prefixes the reducer actually derives."""

    prefixes: set[str] = set()
    for name in ("_source_ref_token", "_required_evidence_tokens"):
        for node in ast.walk(runtime_function(name)):
            if not isinstance(node, ast.JoinedStr):
                continue
            for part in node.values:
                if (
                    isinstance(part, ast.Constant)
                    and isinstance(part.value, str)
                    and part.value.endswith(":")
                    and len(part.value) > 1
                ):
                    prefixes.add(part.value)
    return prefixes


def regression_verdict_keys() -> frozenset[str]:
    """The exact verdict key set `carry_open_watches` compares against."""

    for node in ast.walk(runtime_function("carry_open_watches")):
        if not isinstance(node, ast.Set):
            continue
        if all(
            isinstance(element, ast.Constant) and isinstance(element.value, str)
            for element in node.elts
        ):
            keys = frozenset(element.value for element in node.elts)
            if "watch_id" in keys:
                return keys
    raise AssertionError("missing regression verdict key set in carry_open_watches")


def reducer_total_cycle_source() -> str:
    """The exact expression `evaluate_cycle_evidence` seals as `total_cycle`."""

    for node in ast.walk(runtime_function("evaluate_cycle_evidence")):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == "total_cycle":
                return ast.unparse(value)
    raise AssertionError("evaluate_cycle_evidence seals no total_cycle field")


def total_cycle_is_the_allocated_cycle(expression: str) -> bool:
    """`total_cycle` is the allocated cycle, never a recovery budget bound.

    `AdaptiveRecoveryLedger._limit_cycle` is `start_cycle + total_cycles - 1`:
    the last cycle this invocation is *allowed* to reach, not the cycle it
    actually allocated. Reporting it as `TOTAL_CYCLE` publishes a number the
    loop never reached, and every later invocation resumes from it.
    """

    flat = expression.replace(" ", "")
    return all(
        (
            "recovery_ledger" not in flat,
            "_limit_cycle" not in flat,
            "_start_cycle" not in flat,
            "_total_cycles" not in flat,
            flat in {"root['cycle']", "captured['root_authority']['cycle']"},
        )
    )


def exact_fence_valid(value: object) -> bool:
    return runtime.fence_shape_valid(value)


def scope_digest(scope: list[str], source_bytes: dict[str, bytes]) -> str:
    payload = b"".join(
        path.encode() + b"\0" + hashlib.sha256(source_bytes[path]).hexdigest().encode() + b"\n"
        for path in scope
    )
    return hashlib.sha256(payload).hexdigest()


def canonical_source_triple(
    base: str,
    scope: list[str],
    claimed_hash: str,
    source_bytes: dict[str, bytes],
    approved_triple: tuple[str, tuple[str, ...], str],
    eligibility: str = "current-convergence",
) -> tuple[str, tuple[str, ...], str] | None:
    allow_pre_contract = (
        base == "PRE-CONTRACT" and eligibility == "historical-non-convergence"
    )
    if base == "PRE-CONTRACT" and not allow_pre_contract:
        return None
    try:
        triple = runtime.canonical_fence(
            base,
            scope,
            claimed_hash,
            {path: source_bytes[path] for path in scope},
            repository_root=REPO_ROOT,
            allow_pre_contract=allow_pre_contract,
        )
    except (KeyError, TypeError, ValueError, runtime.RpfContractError):
        return None
    return triple if triple == approved_triple else None


def fence_aliases_valid(
    rows: list[tuple[str, str, list[str], str, str]],
    source_bytes: dict[str, bytes],
    approved_triple: tuple[str, tuple[str, ...], str],
) -> bool:
    if (
        not isinstance(rows, list)
        or any(not isinstance(row, tuple) or len(row) != 5 for row in rows)
    ):
        return False
    id_to_triple: dict[str, tuple[str, str, str]] = {}
    triple_to_id: dict[tuple[str, tuple[str, ...], str], str] = {}
    for fence_id, base, scope, claimed_hash, eligibility in rows:
        if not all(
            isinstance(value, str)
            for value in (fence_id, base, claimed_hash, eligibility)
        ) or not isinstance(scope, list):
            return False
        triple = canonical_source_triple(
            base, scope, claimed_hash, source_bytes, approved_triple, eligibility
        )
        if triple is None:
            return False
        if fence_id in id_to_triple and id_to_triple[fence_id] != triple:
            return False
        if triple in triple_to_id and triple_to_id[triple] != fence_id:
            return False
        id_to_triple[fence_id] = triple
        triple_to_id[triple] = fence_id
    return True


def conditional_publication_result(
    expected_identity: str, current_identity: str, primitive_available: bool
) -> str:
    if expected_identity != current_identity:
        return "reconcile-preserve-base-current-candidate"
    return "published-atomic-exchange" if primitive_available else "deferred-provider-unavailable"


def preallocate_coverage_ids(first: int, count: int) -> list[str]:
    if type(first) is not int or type(count) is not int or first < 1 or count < 1:
        raise ValueError("controller allocation requires positive numeric bounds")
    return [f"COV-{value}" for value in range(first, first + count)]


def authoritative_coverage_mapping(
    metadata_surfaces: list[str],
    preallocated_ids: list[str],
    dispatch: str,
    historical_rows: list[dict[str, object]],
    additional_obligations: list[tuple[str, str]],
) -> dict[str, tuple[str, str]]:
    if (
        not isinstance(metadata_surfaces, list)
        or tuple(metadata_surfaces) != RPF_SOURCE_SURFACES
        or not isinstance(preallocated_ids, list)
        or not isinstance(dispatch, str)
        or not dispatch
        or not isinstance(historical_rows, list)
        or any(not isinstance(row, dict) for row in historical_rows)
        or not isinstance(additional_obligations, list)
        or not additional_obligations
        or any(
            not isinstance(item, tuple)
            or len(item) != 2
            or item[0] != "probe"
            or not isinstance(item[1], str)
            or not item[1].startswith(("claim:", "watch:"))
            for item in additional_obligations
        )
        or any(not isinstance(surface, str) or not surface for surface in metadata_surfaces)
        or len(metadata_surfaces) != len(set(metadata_surfaces))
    ):
        raise ValueError("coverage mapping requires the exact source/catalog inputs")
    obligations = (
        [("inventory", surface) for surface in metadata_surfaces]
        + [("game", family) for family in GAME_FAMILIES]
        + [("probe", family) for family in INCIDENT_FAMILIES]
        + additional_obligations
    )
    if (
        len(preallocated_ids) != len(obligations)
        or len(preallocated_ids) != len(set(preallocated_ids))
        or any(not re.fullmatch(r"COV-\d+", coverage_id) for coverage_id in preallocated_ids)
    ):
        raise ValueError("controller must preallocate unique numeric Coverage IDs")
    used_elsewhere = {
        str(row.get("id"))
        for row in historical_rows
        if row.get("dispatch") != dispatch
    }
    if used_elsewhere.intersection(preallocated_ids):
        raise ValueError("Coverage ID reused across dispatches")
    return dict(zip(preallocated_ids, obligations, strict=True))


def authoritative_captured_projection(
    captured_state: dict[str, object],
    cycle: int,
    run: str,
    fence: tuple[str, str, str],
) -> dict[str, object] | None:
    required_fields = {
        "immutable", "cycle", "run", "fence", "repository_roles",
        "selected_personas",
        "regression_watches", "contracts", "gate_results", "ui_mapping",
        "no_ui_detection", "runtime_records", "backup_records",
        "backup_comparisons", "open_gap_ids", "source_index",
    }
    if (
        not isinstance(captured_state, dict)
        or set(captured_state) != required_fields
        or captured_state.get("immutable") is not True
        or captured_state.get("cycle") != cycle
        or captured_state.get("run") != run
        or captured_state.get("fence") != fence
        or not exact_fence_valid(fence)
    ):
        return None
    repository_roles = captured_state["repository_roles"]
    selected_personas = captured_state["selected_personas"]
    watches = captured_state["regression_watches"]
    contracts = captured_state["contracts"]
    gates = captured_state["gate_results"]
    ui_mapping = captured_state["ui_mapping"]
    no_ui_detection = captured_state["no_ui_detection"]
    runtime_records = captured_state["runtime_records"]
    backup_records = captured_state["backup_records"]
    backup_comparisons = captured_state["backup_comparisons"]
    open_gap_ids = captured_state["open_gap_ids"]
    source_index = captured_state["source_index"]
    if (
        not isinstance(repository_roles, list)
        or any(not isinstance(role, str) or not role for role in repository_roles)
        or len(repository_roles) != len(set(repository_roles))
        or CORE_REQUIRED_ROLES.intersection(repository_roles)
        or not isinstance(selected_personas, list)
        or not 1 <= len(selected_personas) <= 6
        or any(not isinstance(persona, str) or not persona for persona in selected_personas)
        or len(selected_personas) != len(set(selected_personas))
        or not isinstance(watches, list)
        or any(
            not isinstance(watch, dict)
            or set(watch) != {"id", "status", "changed_cycle", "fence"}
            or not isinstance(watch.get("id"), str)
            or not watch.get("id")
            or not isinstance(watch.get("status"), str)
            or watch.get("status") not in {"open", "cleared"}
            or type(watch.get("changed_cycle")) is not int
            or not exact_fence_valid(watch.get("fence"))
            for watch in watches
        )
        or len({watch["id"] for watch in watches}) != len(watches)
        or any(
            watch["status"] == "open" and watch["fence"] != fence
            for watch in watches
        )
        or not isinstance(contracts, dict)
        or any(
            not isinstance(contract_id, str)
            or not contract_id
            or not isinstance(contract, dict)
            or set(contract) != {"name", "changed", "still_current"}
            or not isinstance(contract.get("name"), str)
            or not contract.get("name")
            or type(contract.get("changed")) is not bool
            or type(contract.get("still_current")) is not bool
            for contract_id, contract in contracts.items()
        )
        or not isinstance(gates, list)
        or any(
            not isinstance(gate, dict)
            or set(gate) != {"id", "classification", "affected_contract_ids", "fence"}
            or not isinstance(gate.get("id"), str)
            or not gate.get("id")
            or not isinstance(gate.get("classification"), str)
            or gate.get("classification") not in {
                "passed", "failed", "not-run-prohibited", "not-run-unavailable",
                "not-applicable",
            }
            or not isinstance(gate.get("affected_contract_ids"), list)
            or any(
                not isinstance(contract_id, str) or contract_id not in contracts
                for contract_id in gate.get("affected_contract_ids", [])
            )
            or len(gate.get("affected_contract_ids", []))
            != len(set(gate.get("affected_contract_ids", [])))
            or gate.get("fence") != fence
            for gate in gates
        )
        or len({gate["id"] for gate in gates}) != len(gates)
        or not isinstance(ui_mapping, dict)
        or any(
            not isinstance(ui_id, str)
            or not ui_id
            or not isinstance(kind, str)
            or kind not in {"route", "viewport", "interaction", "variant", "mobile-layout", "accessibility"}
            for ui_id, kind in ui_mapping.items()
        )
        or not isinstance(runtime_records, dict)
        or not isinstance(backup_records, dict)
        or not isinstance(backup_comparisons, dict)
        or not isinstance(open_gap_ids, set)
        or any(
            not isinstance(gap_id, str) or not re.fullmatch(r"GAP-\d+", gap_id)
            for gap_id in open_gap_ids
        )
        or not isinstance(source_index, dict)
        or any(
            not isinstance(path, str)
            or not path
            or not isinstance(entry, dict)
            or set(entry) != {"sha256", "lines", "source_bytes"}
            or not isinstance(entry.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None
            or not isinstance(entry.get("lines"), tuple)
            or not entry["lines"]
            or any(not isinstance(line, str) for line in entry["lines"])
            or not isinstance(entry.get("source_bytes"), bytes)
            for path, entry in source_index.items()
        )
    ):
        return None
    if ui_mapping:
        if set(ui_mapping.values()) != {"route", "viewport", "interaction", "variant", "mobile-layout", "accessibility"} or no_ui_detection is not None:
            return None
    elif (
        not isinstance(no_ui_detection, dict)
        or set(no_ui_detection) != {"id", "status", "kind", "evidence", "cycle", "run", "dispatch", "fence"}
        or not isinstance(no_ui_detection.get("id"), str)
        or not no_ui_detection.get("id")
        or no_ui_detection.get("status") != "not-applicable"
        or no_ui_detection.get("kind") != "no-ui-detection"
        or not isinstance(no_ui_detection.get("evidence"), str)
        or not no_ui_detection.get("evidence")
        or no_ui_detection.get("cycle") != cycle
        or no_ui_detection.get("run") != run
        or not isinstance(no_ui_detection.get("dispatch"), str)
        or not no_ui_detection.get("dispatch")
        or no_ui_detection.get("fence") != fence
    ):
        return None
    runtime_fields = {
        "id", "immutable", "cycle", "run", "fence", "runner", "snapshot_id",
        "command", "action", "expected", "observed", "result",
    }
    if any(
        not isinstance(record_id, str)
        or not record_id
        or not isinstance(record, dict)
        or set(record) != runtime_fields
        or record.get("id") != record_id
        or record.get("immutable") is not True
        or record.get("cycle") != cycle
        or record.get("run") != run
        or record.get("fence") != fence
        or not isinstance(record.get("result"), str)
        or record.get("result") not in {"passed", "failed"}
        or any(
            not isinstance(record.get(field), str) or not record.get(field)
            for field in (
                "runner", "snapshot_id", "command", "action", "expected", "observed",
            )
        )
        or (record.get("result") == "passed" and record.get("observed") != record.get("expected"))
        for record_id, record in runtime_records.items()
    ):
        return None
    backup_record_fields = {
        "id", "immutable", "cycle", "run", "fence", "kind", "endpoint",
        "schema", "version", "content", "ordering",
    }
    if any(
        not isinstance(record_id, str)
        or not record_id
        or not isinstance(record, dict)
        or set(record) != backup_record_fields
        or record.get("id") != record_id
        or record.get("immutable") is not True
        or record.get("cycle") != cycle
        or record.get("run") != run
        or record.get("fence") != fence
        or not isinstance(record.get("kind"), str)
        or record.get("kind") not in {"export", "import"}
        or any(
            not isinstance(record.get(field), str) or not record.get(field)
            for field in ("endpoint", "schema", "version", "content", "ordering")
        )
        for record_id, record in backup_records.items()
    ):
        return None
    backup_comparison_fields = {
        "id", "immutable", "cycle", "run", "fence", "export_record_id",
        "import_record_id", "result",
    }
    if any(
        not isinstance(comparison_id, str)
        or not comparison_id
        or not isinstance(comparison, dict)
        or set(comparison) != backup_comparison_fields
        or comparison.get("id") != comparison_id
        or comparison.get("immutable") is not True
        or comparison.get("cycle") != cycle
        or comparison.get("run") != run
        or comparison.get("fence") != fence
        or comparison.get("result") != "equal"
        or not isinstance(comparison.get("export_record_id"), str)
        or not comparison.get("export_record_id")
        or not isinstance(comparison.get("import_record_id"), str)
        or not comparison.get("import_record_id")
        or comparison.get("export_record_id") == comparison.get("import_record_id")
        or comparison.get("export_record_id") not in backup_records
        or comparison.get("import_record_id") not in backup_records
        or backup_records[comparison["export_record_id"]].get("kind") != "export"
        or backup_records[comparison["import_record_id"]].get("kind") != "import"
        or any(
            backup_records[comparison["export_record_id"]].get(field)
            != backup_records[comparison["import_record_id"]].get(field)
            for field in ("schema", "version", "content", "ordering")
        )
        for comparison_id, comparison in backup_comparisons.items()
    ):
        return None
    affected_ids = {
        contract_id
        for contract_id, contract in contracts.items()
        if contract["changed"]
    } | {
        contract_id
        for gate in gates
        if gate["classification"] in {"not-run-prohibited", "not-run-unavailable"}
        for contract_id in gate["affected_contract_ids"]
        if contracts[contract_id]["still_current"]
    }
    open_current_watches = {
        str(watch["id"]): watch
        for watch in watches
        if watch["status"] == "open"
    }
    required = {
        "pointer-alignment",
        "plan-doc-consistency",
        "aggregate-result-falsifier",
        *(f"conclusion-blind-persona:{persona}" for persona in selected_personas),
    }
    if open_current_watches:
        required.add("regression-falsifier")
    if affected_ids:
        required.add("source-contract-verifier")
    if ui_mapping:
        required.add("ui-runtime-verifier")
    required.update(repository_roles)
    return {
        "capture_identity": {
            "immutable": True,
            "cycle": cycle,
            "run": run,
            "fence": fence,
        },
        "required_roles": required,
        "open_current_watches": open_current_watches,
        "affected_contracts": {
            contract_id: contracts[contract_id]["name"] for contract_id in affected_ids
        },
        "ui_mapping": dict(ui_mapping),
        "no_ui_detection": no_ui_detection,
        "runtime_records": runtime_records,
        "backup_records": backup_records,
        "backup_comparisons": backup_comparisons,
        "open_gap_ids": open_gap_ids,
        "source_index": source_index,
    }


def derive_required_roles(
    captured_state: dict[str, object],
    cycle: int,
    run: str,
    fence: tuple[str, str, str],
) -> set[str] | None:
    projection = authoritative_captured_projection(captured_state, cycle, run, fence)
    return None if projection is None else set(projection["required_roles"])


def backup_restore_evidence_valid(
    row: dict[str, object], captured_projection: dict[str, object]
) -> bool:
    if (
        not isinstance(row, dict)
        or not isinstance(captured_projection, dict)
        or not isinstance(row.get("obligation"), str)
        or not isinstance(row.get("disposition"), str)
    ):
        return False
    if row["obligation"] != "backup-restore-equivalence" or row["disposition"] not in {"applicable", "covered"}:
        return True
    evidence = row.get("backup_restore")
    if not isinstance(evidence, dict) or set(evidence) != {
        "export_producer", "import_consumer", "schema", "version", "content",
        "ordering", "export_record_id", "import_record_id", "comparison_id",
    }:
        return False
    string_fields = (
        "export_producer", "import_consumer", "schema", "version", "content",
        "ordering", "export_record_id", "import_record_id", "comparison_id",
    )
    if not all(
        isinstance(evidence.get(field), str) and evidence.get(field)
        for field in string_fields
    ):
        return False
    identity = captured_projection.get("capture_identity")
    records = captured_projection.get("backup_records")
    comparisons = captured_projection.get("backup_comparisons")
    if (
        not isinstance(identity, dict)
        or set(identity) != {"immutable", "cycle", "run", "fence"}
        or identity.get("immutable") is not True
        or type(identity.get("cycle")) is not int
        or not isinstance(identity.get("run"), str)
        or not identity.get("run")
        or not exact_fence_valid(identity.get("fence"))
        or row.get("cycle") != identity.get("cycle")
        or row.get("run") != identity.get("run")
        or row.get("fence") != identity.get("fence")
        or not isinstance(records, dict)
        or not isinstance(comparisons, dict)
    ):
        return False
    export = records.get(evidence["export_record_id"])
    imported = records.get(evidence["import_record_id"])
    comparison = comparisons.get(evidence["comparison_id"])
    record_fields = {
        "id", "immutable", "cycle", "run", "fence", "kind", "endpoint",
        "schema", "version", "content", "ordering",
    }
    comparison_fields = {
        "id", "immutable", "cycle", "run", "fence", "export_record_id",
        "import_record_id", "result",
    }
    return bool(
        evidence["export_record_id"] != evidence["import_record_id"]
        and isinstance(export, dict)
        and isinstance(imported, dict)
        and isinstance(comparison, dict)
        and set(export) == record_fields
        and set(imported) == record_fields
        and set(comparison) == comparison_fields
        and export.get("id") == evidence["export_record_id"]
        and imported.get("id") == evidence["import_record_id"]
        and comparison.get("id") == evidence["comparison_id"]
        and export.get("immutable") is True
        and imported.get("immutable") is True
        and comparison.get("immutable") is True
        and all(
            item.get(field) == identity[field]
            for item in (export, imported, comparison)
            for field in ("cycle", "run", "fence")
        )
        and export.get("kind") == "export"
        and imported.get("kind") == "import"
        and export.get("endpoint") == evidence["export_producer"]
        and imported.get("endpoint") == evidence["import_consumer"]
        and all(
            export.get(field) == imported.get(field) == evidence[field]
            for field in ("schema", "version", "content", "ordering")
        )
        and comparison.get("export_record_id") == evidence["export_record_id"]
        and comparison.get("import_record_id") == evidence["import_record_id"]
        and comparison.get("result") == "equal"
    )


def evidence_row_is_nonmaterial(
    before: dict[str, object],
    after: dict[str, object],
    current_cycle: int,
    current_run: str,
    clean_fence: tuple[str, str, str],
) -> bool:
    row_fields = {
        "identity", "kind", "cycle", "run", "mandatory", "fence", "outcome",
        "substantive_state",
    }
    substantive_fields = {
        "findings", "gaps", "tasks", "decisions", "residual_risks", "claim",
        "source", "evidence",
    }
    if (
        not isinstance(before, dict)
        or not isinstance(after, dict)
        or set(before) != row_fields
        or set(after) != row_fields
        or not isinstance(before.get("substantive_state"), dict)
        or not isinstance(after.get("substantive_state"), dict)
        or set(before["substantive_state"]) != substantive_fields
        or set(after["substantive_state"]) != substantive_fields
    ):
        return False
    before_state = before["substantive_state"]
    after_state = after["substantive_state"]
    return bool(
        isinstance(after.get("identity"), str)
        and after.get("identity")
        and before.get("identity") == after.get("identity")
        and before.get("kind") == after.get("kind")
        and after.get("kind") in {"role", "result", "coverage", "verification"}
        and before.get("mandatory") is True
        and after.get("mandatory") is True
        and type(before.get("cycle")) is int
        and before.get("cycle") < current_cycle
        and after.get("cycle") == current_cycle
        and isinstance(before.get("run"), str)
        and before.get("run")
        and after.get("run") == current_run
        and before.get("fence") == after.get("fence") == clean_fence
        and before.get("outcome") == after.get("outcome")
        and after.get("outcome") in {"passed", "clean", "covered", "verified", "not-applicable"}
        and before_state == after_state
        and all(
            isinstance(after_state.get(field), list) and not after_state[field]
            for field in ("findings", "gaps", "tasks", "decisions", "residual_risks")
        )
        and all(
            isinstance(after_state.get(field), str) and after_state[field]
            for field in ("claim", "source", "evidence")
        )
    )


def make_captured_state(
    cycle: int,
    run: str,
    fence: tuple[str, str, str],
    *,
    repository_roles: list[str] | None = None,
    selected_personas: list[str] | None = None,
    watches: list[dict[str, object]] | None = None,
    contracts: dict[str, dict[str, object]] | None = None,
    gates: list[dict[str, object]] | None = None,
    ui_mapping: dict[str, str] | None = None,
    runtime_records: dict[str, dict[str, object]] | None = None,
    backup_records: dict[str, dict[str, object]] | None = None,
    backup_comparisons: dict[str, dict[str, object]] | None = None,
    open_gap_ids: set[str] | None = None,
    source_index: dict[str, dict[str, object]] | None = None,
    no_ui_dispatch: str = "dispatch-no-ui",
) -> dict[str, object]:
    mapping = {} if ui_mapping is None else ui_mapping
    return {
        "immutable": True,
        "cycle": cycle,
        "run": run,
        "fence": fence,
        "repository_roles": [] if repository_roles is None else repository_roles,
        "selected_personas": (
            ["security", "testing"]
            if selected_personas is None
            else selected_personas
        ),
        "regression_watches": [] if watches is None else watches,
        "contracts": {} if contracts is None else contracts,
        "gate_results": [] if gates is None else gates,
        "ui_mapping": mapping,
        "no_ui_detection": None if mapping else {
            "id": "UI-NONE-1",
            "status": "not-applicable",
            "kind": "no-ui-detection",
            "evidence": "inventory:no-ui",
            "cycle": cycle,
            "run": run,
            "dispatch": no_ui_dispatch,
            "fence": fence,
        },
        "runtime_records": {} if runtime_records is None else runtime_records,
        "backup_records": {} if backup_records is None else backup_records,
        "backup_comparisons": {} if backup_comparisons is None else backup_comparisons,
        "open_gap_ids": set() if open_gap_ids is None else open_gap_ids,
        "source_index": LEGACY_SOURCE_INDEX if source_index is None else source_index,
    }


def terminal_coverage_row_valid(
    row: dict[str, object],
    expected: tuple[str, str],
    cycle: int,
    run: str,
    dispatch: str,
    fence: tuple[str, str, str],
    captured_state: dict[str, object],
) -> bool:
    projection = authoritative_captured_projection(captured_state, cycle, run, fence)
    if projection is None:
        return False
    if not isinstance(row, dict) or not isinstance(expected, tuple) or len(expected) != 2:
        return False
    return all(
        (
            (row.get("kind"), row.get("obligation")) == expected,
            row.get("disposition") in {"covered", "excluded", "uninspectable", "not-applicable"},
            bool(row.get("evidence")),
            row.get("cycle") == cycle,
            row.get("run") == run,
            row.get("dispatch") == dispatch,
            row.get("fence") == fence,
            backup_restore_evidence_valid(row, projection),
            row.get("disposition") not in {"excluded", "uninspectable"}
            or bool(row.get("reason") and row.get("gap")),
        )
    )


def reduce_independent_review(required_statuses: list[str]) -> str:
    if (
        not isinstance(required_statuses, list)
        or not required_statuses
        or any(not isinstance(status, str) for status in required_statuses)
    ):
        return "incomplete"
    allowed = {"passed", "findings", "failed", "incomplete", "restricted"}
    if any(status not in allowed for status in required_statuses):
        return "incomplete"
    if any(status in {"failed", "incomplete", "restricted"} for status in required_statuses):
        return "incomplete"
    if "findings" in required_statuses:
        return "findings"
    return "clean"


def reduce_required_role_roster(
    rows: list[tuple[str, str, str, str, tuple[str, str, str]]],
    current_fence: tuple[str, str, str],
    captured_state: dict[str, object],
) -> str:
    if not isinstance(captured_state, dict):
        return "incomplete"
    captured_cycle = captured_state.get("cycle")
    captured_run = captured_state.get("run")
    if (
        not isinstance(rows, list)
        or type(captured_cycle) is not int
        or not isinstance(captured_run, str)
        or not captured_run
        or any(
            not isinstance(row, tuple)
            or len(row) != 5
            or any(not isinstance(value, str) for value in row[:4])
            or not exact_fence_valid(row[4])
            for row in rows
        )
    ):
        return "incomplete"
    required_roles = derive_required_roles(
        captured_state,
        captured_cycle,
        captured_run,
        current_fence,
    )
    if required_roles is None:
        return "incomplete"
    seen_role_ids: set[str] = set()
    required_statuses: dict[str, str] = {}
    for role_id, role, required, status, fence in rows:
        if not role_id or role_id in seen_role_ids or required not in {"yes", "no"}:
            return "incomplete"
        if fence != current_fence:
            return "incomplete"
        seen_role_ids.add(role_id)
        if required == "yes":
            if role not in required_roles or role in required_statuses:
                return "incomplete"
            required_statuses[role] = status
        elif role in required_roles:
            return "incomplete"
    if set(required_statuses) != required_roles:
        return "incomplete"
    return reduce_independent_review(list(required_statuses.values()))


def regression_verdicts_pass(
    captured_state: dict[str, object],
    verdicts: list[tuple[str, str, int, tuple[str, str, str]]],
    cycle: int,
    run: str,
    fence: tuple[str, str, str],
) -> bool:
    projection = authoritative_captured_projection(captured_state, cycle, run, fence)
    if (
        projection is None
        or not isinstance(verdicts, list)
        or any(
            not isinstance(verdict, tuple)
            or len(verdict) != 4
            or not isinstance(verdict[0], str)
            or not isinstance(verdict[1], str)
            or type(verdict[2]) is not int
            or not exact_fence_valid(verdict[3])
            for verdict in verdicts
        )
    ):
        return False
    watch_by_id = {
        watch_id: (watch["changed_cycle"], watch["fence"])
        for watch_id, watch in projection["open_current_watches"].items()
    }
    if not watch_by_id or len(verdicts) != len(watch_by_id):
        return False
    verdict_by_watch: dict[str, tuple[str, int, tuple[str, str, str]]] = {}
    for watch_id, status, cycle, fence in verdicts:
        if watch_id in verdict_by_watch or watch_id not in watch_by_id:
            return False
        verdict_by_watch[watch_id] = (status, cycle, fence)
    cycles = {cycle for _, cycle, _ in verdict_by_watch.values()}
    if len(cycles) != 1:
        return False
    return all(
        status == "passed" and cycle > watch_by_id[watch_id][0] and fence == watch_by_id[watch_id][1]
        for watch_id, (status, cycle, fence) in verdict_by_watch.items()
    )


def quarantined_item_count(
    restricted_rows: list[tuple[str, list[str]]], nonterminal_ids: set[str]
) -> int | None:
    if (
        not isinstance(restricted_rows, list)
        or not isinstance(nonterminal_ids, set)
        or any(
            not isinstance(item, str)
            or not re.fullmatch(r"(?:RPF|GAP)-\d+", item)
            for item in nonterminal_ids
        )
        or any(
            not isinstance(row, tuple)
            or len(row) != 2
            or not isinstance(row[0], str)
            or not isinstance(row[1], list)
            or any(not isinstance(link, str) for link in row[1])
            for row in restricted_rows
        )
    ):
        return None
    links: set[str] = set()
    for status, row_links in restricted_rows:
        if status != "restricted":
            continue
        if not row_links:
            return None
        for link in row_links:
            if not re.fullmatch(r"(?:RPF|GAP)-\d+", link) or link not in nonterminal_ids:
                return None
            links.add(link)
    return len(links)


def required_dispatch_coverage_complete(
    required_roles: set[str],
    roster: list[dict[str, object]],
    coverage: list[dict[str, object]],
    preallocated_by_dispatch: dict[str, list[str]],
    role_obligations: dict[str, list[tuple[str, str]]],
    historical_coverage: list[dict[str, object]],
    current_cycle: int,
    current_run: str,
    current_fence: tuple[str, str, str],
    captured_state: dict[str, object],
) -> bool:
    if (
        not isinstance(required_roles, set)
        or not required_roles
        or any(not isinstance(role, str) or not role for role in required_roles)
        or not isinstance(roster, list)
        or not isinstance(coverage, list)
        or not isinstance(preallocated_by_dispatch, dict)
        or not isinstance(role_obligations, dict)
        or not isinstance(historical_coverage, list)
        or any(not isinstance(row, dict) for row in roster + coverage + historical_coverage)
        or any(
            not isinstance(row.get("role"), str)
            or not isinstance(row.get("required"), str)
            or not isinstance(row.get("dispatch"), str)
            for row in roster
        )
        or type(current_cycle) is not int
        or not isinstance(current_run, str)
        or not current_run
        or not exact_fence_valid(current_fence)
    ):
        return False
    captured_projection = authoritative_captured_projection(
        captured_state, current_cycle, current_run, current_fence
    )
    if (
        captured_projection is None
        or required_roles != captured_projection["required_roles"]
    ):
        return False
    required_rows = [
        row for row in roster
        if row.get("cycle") == current_cycle
        and row.get("run") == current_run
        and row.get("required") == "yes"
    ]
    if {row.get("role") for row in required_rows} != required_roles:
        return False
    all_allocated: list[str] = []
    for row in required_rows:
        role = str(row.get("role", ""))
        dispatch = str(row.get("dispatch", ""))
        allocated = preallocated_by_dispatch.get(dispatch)
        extra = role_obligations.get(role)
        linked_coverage_ids = row.get("coverage_ids")
        if (
            not isinstance(allocated, list)
            or not isinstance(extra, list)
            or not isinstance(linked_coverage_ids, list)
            or any(
                not isinstance(coverage_id, str) or not coverage_id
                for coverage_id in linked_coverage_ids
            )
        ):
            return False
        try:
            expected = authoritative_coverage_mapping(
                list(RPF_SOURCE_SURFACES), allocated, dispatch, historical_coverage, extra
            )
        except (TypeError, ValueError):
            return False
        all_allocated.extend(allocated)
        dispatch_rows = [
            item for item in coverage
            if item.get("cycle") == current_cycle
            and item.get("run") == current_run
            and item.get("dispatch") == dispatch
            and item.get("fence") == current_fence
        ]
        if not coverage_obligations_complete(
            expected, dispatch_rows, set(), current_cycle, current_run, dispatch,
            current_fence, captured_state
        ):
            return False
        if set(linked_coverage_ids) != set(expected):
            return False
    return len(all_allocated) == len(set(all_allocated))


def current_roster_result(
    roster: list[dict[str, object]],
    coverage: list[dict[str, object]],
    results: list[dict[str, object]],
    current_cycle: int,
    current_run: str,
    current_fence: tuple[str, str, str],
    evidence_histories: dict[str, list[dict[str, object]]],
    specialized_rows: list[dict[str, object]],
    captured_state: dict[str, object],
    preallocated_by_dispatch: dict[str, list[str]],
    role_obligations: dict[str, list[tuple[str, str]]],
) -> str:
    required_history_tables = {
        "required-role", "review-result", "coverage", "aggregate-result",
        "regression", "source-contract", "ui", "gate-result",
    }
    roster_fields = {
        "cycle", "run", "role_id", "dispatch", "role", "required", "fence",
        "status", "coverage_ids", "result_id",
    }
    coverage_fields = {
        "id", "cycle", "run", "dispatch", "fence", "kind", "obligation",
        "disposition", "evidence",
    }
    result_fields = {
        "id", "cycle", "run", "role_id", "dispatch", "fence", "required_status",
        "status", "counterexample_search", "source_grounded_evidence", "coverage_ids",
        "specialized_detail_ids",
    }
    specialized_fields = {
        "id", "cycle", "run", "dispatch", "fence", "type", "status",
        "coverage_ids", "source_grounded_evidence",
    }
    history_fields = {"cycle", "run", "dispatch"}
    history_id_fields = {
        "required-role": ("role_id",),
        "review-result": ("id", "role_id"),
        "coverage": ("id",),
        "aggregate-result": ("id",),
        "regression": ("id",),
        "source-contract": ("id",),
        "ui": ("id",),
        "gate-result": ("id",),
    }

    def identity_valid(row: dict[str, object], *, fenced: bool) -> bool:
        return bool(
            type(row.get("cycle")) is int
            and isinstance(row.get("run"), str)
            and row.get("run")
            and isinstance(row.get("dispatch"), str)
            and row.get("dispatch")
            and (
                not fenced
                or exact_fence_valid(row.get("fence"))
            )
        )

    def strings_valid(row: dict[str, object], fields: set[str]) -> bool:
        return all(isinstance(row.get(field), str) and row.get(field) for field in fields)

    if (
        not isinstance(roster, list)
        or not isinstance(coverage, list)
        or not isinstance(results, list)
        or not isinstance(specialized_rows, list)
        or not isinstance(evidence_histories, dict)
        or set(evidence_histories) != required_history_tables
        or any(not isinstance(rows, list) for rows in evidence_histories.values())
        or any(
            not isinstance(row, dict)
            or not history_fields.issubset(row)
            or not identity_valid(row, fenced=False)
            or any(
                not isinstance(row.get(field), str) or not row.get(field)
                for field in history_id_fields[history_name]
            )
            for history_name, rows in evidence_histories.items()
            for row in rows
        )
        or any(
            not isinstance(row, dict)
            or not roster_fields.issubset(row)
            or not identity_valid(row, fenced=True)
            or not strings_valid(
                row, {"role_id", "role", "required", "status", "result_id"}
            )
            or not isinstance(row.get("coverage_ids"), list)
            or any(
                not isinstance(item, str) or not item for item in row.get("coverage_ids", [])
            )
            for row in roster
        )
        or any(
            not isinstance(row, dict) or not coverage_fields.issubset(row)
            or not identity_valid(row, fenced=True)
            or not strings_valid(
                row, {"id", "kind", "obligation", "disposition", "evidence"}
            )
            for row in coverage
        )
        or any(
            not isinstance(row, dict)
            or not result_fields.issubset(row)
            or not identity_valid(row, fenced=True)
            or not strings_valid(
                row,
                {
                    "id", "role_id", "required_status", "status",
                    "counterexample_search", "source_grounded_evidence",
                },
            )
            or not isinstance(row.get("coverage_ids"), list)
            or not isinstance(row.get("specialized_detail_ids"), list)
            or any(
                not isinstance(item, str) or not item
                for item in row.get("coverage_ids", []) + row.get("specialized_detail_ids", [])
            )
            for row in results
        )
        or any(
            not isinstance(row, dict) or not specialized_fields.issubset(row)
            or not identity_valid(row, fenced=True)
            or not strings_valid(
                row, {"id", "type", "status", "source_grounded_evidence"}
            )
            or not isinstance(row.get("coverage_ids"), list)
            or any(
                not isinstance(item, str) or not item for item in row.get("coverage_ids", [])
            )
            for row in specialized_rows
        )
    ):
        return "incomplete"
    required_roles = derive_required_roles(
        captured_state, current_cycle, current_run, current_fence
    )
    if required_roles is None or not required_dispatch_coverage_complete(
        required_roles,
        roster,
        coverage,
        preallocated_by_dispatch,
        role_obligations,
        evidence_histories["coverage"],
        current_cycle,
        current_run,
        current_fence,
        captured_state,
    ):
        return "incomplete"
    current = [
        row
        for row in roster
        if row["cycle"] == current_cycle and row["run"] == current_run
    ]
    if not current:
        return "incomplete"
    role_ids = [str(row.get("role_id", "")) for row in roster]
    current_role_ids = {str(row.get("role_id", "")) for row in current}
    historical_role_ids = {
        str(row.get("role_id", ""))
        for row in (
            evidence_histories["required-role"]
            + evidence_histories["review-result"]
        )
        if row.get("role_id")
    }
    current_result_ids = {str(row.get("result_id", "")) for row in current}
    historical_result_ids = {
        str(row.get("id", "")) for row in evidence_histories["review-result"]
    }
    if (
        any(not role_id for role_id in role_ids)
        or len(role_ids) != len(set(role_ids))
        or bool(current_role_ids.intersection(historical_role_ids))
        or bool(current_result_ids.intersection(historical_result_ids))
    ):
        return "incomplete"
    current_dispatches = {str(row["dispatch"]) for row in current}
    if any(
        str(row["dispatch"]) in current_dispatches
        and (row["cycle"] != current_cycle or row["run"] != current_run)
        for row in roster
    ):
        return "incomplete"
    for history in [coverage, results, specialized_rows, *evidence_histories.values()]:
        if any(
            str(row.get("dispatch", "")) in current_dispatches
            and (row.get("cycle") != current_cycle or row.get("run") != current_run)
            for row in history
        ):
            return "incomplete"
    coverage_by_id = {row["id"]: row for row in coverage}
    result_by_id = {row["id"]: row for row in results}
    specialized_by_id = {row["id"]: row for row in specialized_rows}
    if (
        len(coverage_by_id) != len(coverage)
        or len(result_by_id) != len(results)
        or len(specialized_by_id) != len(specialized_rows)
    ):
        return "incomplete"
    specialized_contract = {
        "aggregate-result-falsifier": "aggregate",
        "source-contract-verifier": "source-contract",
        "regression-falsifier": "regression",
    }
    seen_roles: set[str] = set()
    dispatches: set[str] = set()
    linked_results: set[str] = set()
    statuses: list[str] = []
    for row in current:
        role = str(row["role"])
        role_id = str(row["role_id"])
        dispatch = str(row["dispatch"])
        coverage_ids = list(row["coverage_ids"])
        result_id = str(row["result_id"])
        required = str(row["required"])
        if (
            required not in {"yes", "no"}
            or row["status"] not in {"passed", "findings", "failed", "incomplete", "restricted", "not-applicable"}
            or (required == "yes" and role not in required_roles)
            or (required == "no" and role in required_roles)
            or role in seen_roles
            or not dispatch
            or dispatch in dispatches
            or row["fence"] != current_fence
            or not coverage_ids
            or len(coverage_ids) != len(set(coverage_ids))
            or not result_id
            or result_id in linked_results
        ):
            return "incomplete"
        seen_roles.add(role)
        dispatches.add(dispatch)
        linked_results.add(result_id)
        dispatch_coverage = [
            linked for linked in coverage
            if all(
                linked.get(field) == expected
                for field, expected in (
                    ("cycle", current_cycle), ("run", current_run),
                    ("dispatch", dispatch), ("fence", current_fence),
                )
            )
        ]
        if {str(linked["id"]) for linked in dispatch_coverage} != set(coverage_ids):
            return "incomplete"
        for coverage_id in coverage_ids:
            linked = coverage_by_id.get(coverage_id)
            if not linked or any(
                linked[field] != expected
                for field, expected in (
                    ("cycle", current_cycle),
                    ("run", current_run),
                    ("dispatch", dispatch),
                    ("fence", current_fence),
                )
            ) or not linked.get("kind") or not linked.get("obligation") or linked.get("disposition") not in {
                "covered", "excluded", "uninspectable", "not-applicable"
            } or not linked.get("evidence"):
                return "incomplete"
        result = result_by_id.get(result_id)
        if not result or any(
            result[field] != expected
            for field, expected in (
                ("cycle", current_cycle),
                ("run", current_run),
                ("role_id", role_id),
                ("dispatch", dispatch),
                ("fence", current_fence),
                ("required_status", required),
                ("status", row["status"]),
            )
        ):
            return "incomplete"
        result_coverage = list(result.get("coverage_ids", []))
        details = list(result.get("specialized_detail_ids", []))
        if (
            set(result_coverage) != set(coverage_ids)
            or len(result_coverage) != len(set(result_coverage))
            or len(details) != len(set(details))
            or not result.get("counterexample_search")
            or not result.get("source_grounded_evidence")
        ):
            return "incomplete"
        dispatch_details = [
            detail for detail in specialized_rows
            if all(
                detail.get(field) == expected
                for field, expected in (
                    ("cycle", current_cycle), ("run", current_run),
                    ("dispatch", dispatch), ("fence", current_fence),
                )
            )
        ]
        if {str(detail["id"]) for detail in dispatch_details} != set(details):
            return "incomplete"
        expected_detail = specialized_contract.get(role)
        if expected_detail is None:
            if details:
                return "incomplete"
        elif not details:
            return "incomplete"
        for detail_id in details:
            detail = specialized_by_id.get(detail_id)
            detail_coverage = list(detail.get("coverage_ids", [])) if detail else []
            if (
                not detail
                or expected_detail is None
                or not str(detail_id)
                or detail.get("type") != expected_detail
                or any(
                    detail.get(field) != expected
                    for field, expected in (
                        ("cycle", current_cycle), ("run", current_run),
                        ("dispatch", dispatch), ("fence", current_fence),
                        ("status", row["status"]),
                    )
                )
                or not detail_coverage
                or len(detail_coverage) != len(set(detail_coverage))
                or set(detail_coverage) != set(coverage_ids)
                or not detail.get("source_grounded_evidence")
            ):
                return "incomplete"
        if required == "yes":
            statuses.append(str(row["status"]))
    seen_required_roles = {
        str(row["role"]) for row in current if row["required"] == "yes"
    }
    if seen_required_roles != required_roles or linked_results != {
        str(result["id"])
        for result in results
        if result["cycle"] == current_cycle and result["run"] == current_run
    }:
        return "incomplete"
    return reduce_independent_review(statuses)


def current_regression_passes(
    captured_state: dict[str, object],
    verdicts: list[dict[str, object]],
    persona: dict[str, object],
    regression_role: dict[str, object],
    prior_dispatches: set[str],
    coverage: list[dict[str, object]],
    expected_coverage_mapping: dict[str, tuple[str, str]],
    current_cycle: int,
    current_run: str,
    current_fence: tuple[str, str, str],
) -> bool:
    projection = authoritative_captured_projection(
        captured_state, current_cycle, current_run, current_fence
    )
    if projection is None:
        return False
    watches = list(projection["open_current_watches"].values())
    if (
        not isinstance(verdicts, list)
        or not isinstance(persona, dict)
        or not isinstance(regression_role, dict)
        or not isinstance(prior_dispatches, set)
        or not isinstance(coverage, list)
        or not isinstance(expected_coverage_mapping, dict)
        or any(not isinstance(row, dict) for row in watches + verdicts + coverage)
        or any(
            not isinstance(row.get("id"), str) or not row.get("id")
            for row in coverage
        )
        or any(
            not isinstance(watch.get("id"), str)
            or not watch.get("id")
            or type(watch.get("changed_cycle")) is not int
            for watch in watches
        )
        or any(
            not isinstance(verdict.get(field), str) or not verdict.get(field)
            for verdict in verdicts
            for field in ("id", "watch_id", "coverage_id", "dispatch")
        )
    ):
        return False
    if any(
        persona.get(field) != expected
        for field, expected in (
            ("status", "clean"),
            ("cycle", current_cycle),
            ("run", current_run),
            ("fence", current_fence),
        )
    ):
        return False
    if not watches or any(watch.get("fence") != current_fence for watch in watches):
        return False
    watch_by_id = {watch.get("id"): watch for watch in watches}
    verdict_by_watch = {verdict.get("watch_id"): verdict for verdict in verdicts}
    coverage_by_id = {row.get("id"): row for row in coverage}
    if (
        len(watch_by_id) != len(watches)
        or len(verdict_by_watch) != len(verdicts)
        or set(verdict_by_watch) != set(watch_by_id)
        or len(coverage_by_id) != len(coverage)
        or not expected_coverage_mapping
        or set(coverage_by_id) != set(expected_coverage_mapping)
    ):
        return False
    dispatches = {verdict.get("dispatch") for verdict in verdicts}
    if len(dispatches) != 1 or not next(iter(dispatches), ""):
        return False
    dispatch = next(iter(dispatches))
    if dispatch in prior_dispatches:
        return False
    expected_verdict_ids = {str(verdict.get("id", "")) for verdict in verdicts}
    verdict_coverage_ids = {str(verdict.get("coverage_id", "")) for verdict in verdicts}
    if (
        "" in expected_verdict_ids
        or "" in verdict_coverage_ids
        or len(expected_verdict_ids) != len(verdicts)
        or len(verdict_coverage_ids) != len(verdicts)
        or not coverage_obligations_complete(
            expected_coverage_mapping,
            coverage,
            set(),
            current_cycle,
            current_run,
            dispatch,
            current_fence,
            captured_state,
        )
    ):
        return False
    if any(
        regression_role.get(field) != expected
        for field, expected in (
            ("role", "regression-falsifier"),
            ("required", "yes"),
            ("status", "passed"),
            ("cycle", current_cycle),
            ("run", current_run),
            ("dispatch", dispatch),
            ("fence", current_fence),
        )
    ):
        return False
    role_verdict_ids = regression_role.get("verdict_ids")
    role_coverage_ids = regression_role.get("coverage_ids")
    if not isinstance(role_verdict_ids, list) or not isinstance(role_coverage_ids, list):
        return False
    if any(
        not isinstance(item, str) or not item
        for item in role_verdict_ids + role_coverage_ids
    ):
        return False
    if len(role_verdict_ids) != len(set(role_verdict_ids)):
        return False
    if len(role_coverage_ids) != len(set(role_coverage_ids)):
        return False
    if set(role_verdict_ids) != expected_verdict_ids:
        return False
    if set(role_coverage_ids) != set(expected_coverage_mapping):
        return False
    for watch_id, verdict in verdict_by_watch.items():
        coverage_id = str(verdict.get("coverage_id", ""))
        if (
            verdict.get("status") != "passed"
            or verdict.get("cycle") != current_cycle
            or verdict.get("run") != current_run
            or verdict.get("fence") != current_fence
            or not isinstance(watch_by_id[watch_id].get("changed_cycle"), int)
            or current_cycle <= watch_by_id[watch_id]["changed_cycle"]
            or expected_coverage_mapping.get(coverage_id) != ("probe", f"watch:{watch_id}")
            or not verdict.get("counterexample_search")
            or not verdict.get("source_grounded_evidence")
        ):
            return False
        linked = coverage_by_id.get(coverage_id)
        if not linked or not terminal_coverage_row_valid(
            linked,
            expected_coverage_mapping[coverage_id],
            current_cycle,
            current_run,
            dispatch,
            current_fence,
            captured_state,
        ):
            return False
    return True


def coverage_obligations_complete(
    expected_mapping: dict[str, tuple[str, str]],
    rows: list[dict[str, object]],
    open_gap_ids: set[str],
    cycle: int,
    run: str,
    dispatch: str,
    fence: tuple[str, str, str],
    captured_state: dict[str, object],
) -> bool:
    allowed_kinds = {"inventory", "game", "probe"}
    terminal = {"covered", "excluded", "uninspectable", "not-applicable"}
    required_row_fields = {
        "id", "kind", "obligation", "disposition", "evidence", "reason", "gap",
        "cycle", "run", "dispatch", "fence",
    }
    captured_projection = authoritative_captured_projection(
        captured_state, cycle, run, fence
    )
    if (
        captured_projection is None
        or
        not isinstance(expected_mapping, dict)
        or not isinstance(rows, list)
        or not isinstance(open_gap_ids, set)
        or any(
            not isinstance(row, dict) or not required_row_fields.issubset(row)
            or not all(
                isinstance(row.get(field), str)
                for field in (
                    "id", "kind", "obligation", "disposition", "evidence", "reason", "gap",
                    "run", "dispatch",
                )
            )
            for row in rows
        )
        or any(
            not isinstance(coverage_id, str)
            or not re.fullmatch(r"COV-\d+", coverage_id)
            or not isinstance(obligation, tuple)
            or len(obligation) != 2
            or any(not isinstance(value, str) for value in obligation)
            for coverage_id, obligation in expected_mapping.items()
        )
    ):
        return False
    base_obligations = {
        *[("inventory", surface) for surface in RPF_SOURCE_SURFACES],
        *[("game", family) for family in GAME_FAMILIES],
        *[("probe", family) for family in INCIDENT_FAMILIES],
    }
    expected_obligations = set(expected_mapping.values())
    if (
        not base_obligations.issubset(expected_obligations)
        or not any(
            kind == "probe" and identity.startswith(("claim:", "watch:"))
            for kind, identity in expected_obligations
            if isinstance(kind, str) and isinstance(identity, str)
        )
    ):
        return False
    by_id = {row.get("id"): row for row in rows}
    if (
        not expected_mapping
        or any(
            not isinstance(gap_id, str) or not re.fullmatch(r"GAP-\d+", gap_id)
            for gap_id in open_gap_ids
        )
        or len(by_id) != len(rows)
        or set(by_id) != set(expected_mapping)
    ):
        return False
    return all(
        row["kind"] in allowed_kinds
        and (row["kind"], row["obligation"]) == expected_mapping[row["id"]]
        and row["disposition"] in terminal
        and bool(row["evidence"])
        and backup_restore_evidence_valid(row, captured_projection)
        and all(
            row[field] == expected
            for field, expected in (
                ("cycle", cycle),
                ("run", run),
                ("dispatch", dispatch),
                ("fence", fence),
            )
        )
        and (
            row["disposition"] not in {"excluded", "uninspectable"}
            or bool(
                row["reason"]
                and re.fullmatch(r"GAP-\d+", str(row["gap"]))
                and row["gap"] in open_gap_ids
            )
        )
        for row in rows
    )


def source_contract_status(
    captured_state: dict[str, object],
    rows: list[dict[str, object]],
    coverage_rows: list[dict[str, object]],
    expected_coverage_mapping: dict[str, tuple[str, str]],
    cycle: int,
    run: str,
    dispatch: str,
    fence: tuple[str, str, str],
) -> str:
    contract_fields = {
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
    projection = authoritative_captured_projection(captured_state, cycle, run, fence)
    if projection is None:
        return "incomplete"
    expected_mapping = projection["affected_contracts"]
    if (
        not isinstance(rows, list)
        or not isinstance(coverage_rows, list)
        or not isinstance(expected_coverage_mapping, dict)
        or any(not isinstance(row, dict) for row in rows + coverage_rows)
        or any(
            not isinstance(contract_id, str) or not isinstance(contract, str)
            for contract_id, contract in expected_mapping.items()
        )
        or any(not isinstance(row.get("id"), str) for row in rows + coverage_rows)
    ):
        return "incomplete"
    by_id = {row.get("id"): row for row in rows}
    coverage_by_id = {row.get("id"): row for row in coverage_rows}
    if not expected_mapping:
        return "not-applicable" if not rows else "incomplete"
    if (
        len(by_id) != len(rows)
        or set(by_id) != set(expected_mapping)
        or len(coverage_by_id) != len(coverage_rows)
        or not coverage_obligations_complete(
            expected_coverage_mapping,
            coverage_rows,
            set(),
            cycle,
            run,
            dispatch,
            fence,
            captured_state,
        )
    ):
        return "incomplete"
    statuses: list[str] = []
    for row in rows:
        coverage_ids = row.get("coverage_ids")
        status = row.get("status")
        if (
            status not in {"verified", "falsified", "incomplete"}
            or row.get("contract") != expected_mapping[row["id"]]
            or not isinstance(coverage_ids, list)
            or any(
                not isinstance(coverage_id, str) or not coverage_id
                for coverage_id in coverage_ids
            )
            or len(coverage_ids) != len(set(coverage_ids))
            or set(coverage_ids) != set(coverage_by_id)
            or set(coverage_by_id) != set(expected_coverage_mapping)
            or any(
                row.get(field) != expected
                for field, expected in (
                    ("cycle", cycle), ("run_id", run),
                    ("dispatch_id", dispatch), ("fence", fence),
                )
            )
        ):
            return "incomplete"
        if status in {"verified", "falsified"}:
            payload = {field: row.get(field) for field in contract_fields}
            if any(payload.get(field) in (None, "", [], {}) for field in contract_fields):
                return "incomplete"
            source_index = projection["source_index"]

            def valid_ref(ref: object) -> bool:
                return runtime.source_ref_valid(
                    ref, source_index, fence, REPO_ROOT
                )

            def valid_claim(claim: object) -> bool:
                return bool(
                    isinstance(claim, dict)
                    and set(claim) == {"claim", "refs"}
                    and isinstance(claim.get("claim"), str)
                    and claim["claim"]
                    and isinstance(claim.get("refs"), list)
                    and claim["refs"]
                    and all(valid_ref(ref) for ref in claim["refs"])
                )

            if (
                not valid_ref(payload["producer"])
                or not isinstance(payload["consumers"], list)
                or not payload["consumers"]
                or not all(valid_ref(ref) for ref in payload["consumers"])
                or not isinstance(payload["invariants"], list)
                or not payload["invariants"]
                or not all(valid_claim(claim) for claim in payload["invariants"])
                or not all(
                    valid_claim(payload[field])
                    for field in ("success", "error", "variants", "counterexample")
                )
            ):
                return "incomplete"
        statuses.append(str(status))
    if "falsified" in statuses:
        return "failed"
    return "passed" if all(status == "verified" for status in statuses) else "incomplete"


def reduce_ui_status(
    captured_state: dict[str, object],
    rows: list[dict[str, object]],
    coverage_rows: list[dict[str, object]],
    expected_coverage_mapping: dict[str, tuple[str, str]],
    cycle: int,
    run: str,
    dispatch: str,
    fence: tuple[str, str, str],
) -> str:
    kinds = {"route", "viewport", "interaction", "variant", "mobile-layout", "accessibility"}
    required_ui_fields = {
        "id", "status", "kind", "disposition", "evidence_kind", "evidence",
        "runtime_record_id", "blocker", "coverage_id", "cycle", "run", "dispatch",
        "fence",
    }
    projection = authoritative_captured_projection(captured_state, cycle, run, fence)
    if projection is None:
        return "unverified-unavailable"
    expected_mapping = projection["ui_mapping"]
    no_ui_detection = projection["no_ui_detection"]
    runtime_records = projection["runtime_records"]
    open_gap_ids = projection["open_gap_ids"]
    if not expected_mapping:
        if (
            rows == [no_ui_detection]
            and not coverage_rows
            and not expected_coverage_mapping
            and no_ui_detection.get("dispatch") == dispatch
        ):
            return "not-applicable"
        return "unverified-unavailable"
    if (
        not isinstance(rows, list)
        or not isinstance(coverage_rows, list)
        or not isinstance(expected_coverage_mapping, dict)
        or any(
            not isinstance(row, dict) or not required_ui_fields.issubset(row)
            or not all(
                isinstance(row.get(field), str)
                for field in (
                    "id", "status", "kind", "disposition", "evidence_kind", "evidence",
                    "runtime_record_id", "blocker", "coverage_id", "run", "dispatch",
                )
            )
            for row in rows
        )
        or any(
            not isinstance(row, dict) or not isinstance(row.get("id"), str)
            for row in coverage_rows
        )
    ):
        return "unverified-unavailable"
    by_id = {row["id"]: row for row in rows}
    coverage_by_id = {row.get("id"): row for row in coverage_rows}
    if (
        set(expected_mapping.values()) != kinds
        or len(by_id) != len(rows)
        or set(by_id) != set(expected_mapping)
        or not expected_coverage_mapping
        or len(coverage_by_id) != len(coverage_rows)
        or set(coverage_by_id) != set(expected_coverage_mapping)
        or len({str(row.get("coverage_id", "")) for row in rows}) != len(rows)
        or any(row.get("status") == "not-applicable" for row in rows)
        or not coverage_obligations_complete(
            expected_coverage_mapping,
            coverage_rows,
            open_gap_ids,
            cycle,
            run,
            dispatch,
            fence,
            captured_state,
        )
    ):
        return "unverified-unavailable"
    state_rules = {
        "verified": ("covered", "runtime"),
        "failed": ("covered", "runtime"),
        "unverified-prohibited": ("excluded", "none"),
        "unverified-unavailable": ("uninspectable", "none"),
        "not-applicable": ("not-applicable", "none"),
    }
    reduced: list[str] = []
    runtime_ids: list[str] = []
    for row in rows:
        status = row["status"]
        linked = coverage_by_id.get(row["coverage_id"])
        record = runtime_records.get(row["runtime_record_id"])
        common_valid = bool(
            status in state_rules
            and row["kind"] == expected_mapping[row["id"]]
            and bool(row["evidence"])
            and linked
            and linked.get("disposition") == state_rules.get(status, ("", ""))[0]
            and row["disposition"] == state_rules.get(status, ("", ""))[0]
            and row["evidence_kind"] == state_rules.get(status, ("", ""))[1]
            and terminal_coverage_row_valid(
                linked,
                expected_coverage_mapping[row["coverage_id"]],
                cycle,
                run,
                dispatch,
                fence,
                captured_state,
            )
            and all(
                row[field] == expected
                for field, expected in (
                    ("cycle", cycle), ("run", run), ("dispatch", dispatch), ("fence", fence),
                )
            )
        )
        if not common_valid:
            reduced.append("unverified-unavailable")
            continue
        if status in {"verified", "failed"}:
            runtime_ids.append(row["runtime_record_id"])
            if not isinstance(record, dict) or (
                status == "verified"
                and (record.get("result") != "passed" or record.get("observed") != record.get("expected"))
            ) or (status == "failed" and record.get("result") != "failed"):
                reduced.append("unverified-unavailable")
                continue
        elif row["runtime_record_id"] or (
            status in {"unverified-prohibited", "unverified-unavailable"} and not row["blocker"]
        ):
            reduced.append("unverified-unavailable")
            continue
        reduced.append(status)
    if len(runtime_ids) != len(set(runtime_ids)):
        reduced.append("unverified-unavailable")
    order = {
        "failed": 0,
        "unverified-prohibited": 1,
        "unverified-unavailable": 2,
        "verified": 3,
        "not-applicable": 4,
    }
    return min(reduced, key=order.__getitem__) if reduced else "unverified-unavailable"


def convergence_rows_unambiguous(rows: list[tuple[str, int, str]]) -> bool:
    if (
        not isinstance(rows, list)
        or not rows
        or any(
            not isinstance(row, tuple)
            or len(row) != 3
            or not isinstance(row[0], str)
            or type(row[1]) is not int
            or not isinstance(row[2], str)
            for row in rows
        )
    ):
        return False
    seen: dict[tuple[str, int], tuple[str, int, str]] = {}
    for row in rows:
        key = (row[0], row[1])
        if key in seen and seen[key] != row:
            return False
        seen[key] = row
    return True


def gate_results_green(
    rows: list[dict[str, object]],
    expected_commands: set[str],
    gate_head_sha: str,
    current_fence: tuple[str, str, str],
    approved_snapshot_identity: str,
    approved_snapshot_hash: str,
) -> bool:
    if (
        not isinstance(rows, list)
        or not isinstance(expected_commands, set)
        or not expected_commands
        or any(not isinstance(command, str) or not command for command in expected_commands)
        or not isinstance(gate_head_sha, str)
        or not re.fullmatch(r"[0-9a-f]{40}", gate_head_sha)
        or not exact_fence_valid(current_fence)
        or not isinstance(approved_snapshot_identity, str)
        or not approved_snapshot_identity
        or not isinstance(approved_snapshot_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", approved_snapshot_hash)
        or any(
            not isinstance(row, dict)
            or not {"command", "status", "fence", "gate_snapshot"}.issubset(row)
            or not isinstance(row.get("command"), str)
            or not row.get("command")
            for row in rows
        )
    ):
        return False
    by_command = {row["command"]: row for row in rows}
    if (
        len(by_command) != len(rows)
        or set(by_command) != expected_commands
    ):
        return False
    for row in rows:
        snapshot = row.get("gate_snapshot")
        if (
            row.get("status") != "passed"
            or row.get("fence") != current_fence
            or not isinstance(snapshot, dict)
            or snapshot.get("fence") != current_fence
            or snapshot.get("identity") != approved_snapshot_identity
            or snapshot.get("source_hash") != approved_snapshot_hash
            or snapshot.get("post_run_identity") != approved_snapshot_identity
        ):
            return False
        if snapshot.get("kind") == "commit":
            if (
                not isinstance(snapshot.get("sha"), str)
                or not isinstance(row.get("head_after"), str)
                or not re.fullmatch(r"[0-9a-f]{40}", str(snapshot.get("sha")))
                or not re.fullmatch(r"[0-9a-f]{40}", str(row.get("head_after")))
                or snapshot.get("sha") != gate_head_sha
                or row.get("head_after") != gate_head_sha
            ):
                return False
        elif snapshot.get("kind") == "authorized-commit-prohibited":
            before = snapshot.get("before")
            after = snapshot.get("after")
            if (
                not snapshot.get("authority")
                or snapshot.get("isolated") is not True
                or not isinstance(before, str)
                or not isinstance(after, str)
                or not re.fullmatch(r"[0-9a-f]{64}", before)
                or not re.fullmatch(r"[0-9a-f]{64}", after)
                or before != approved_snapshot_hash
                or after != approved_snapshot_hash
            ):
                return False
        else:
            return False
    return True


class RpfContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = read("SKILL.md")
        cls.orchestration = read("references/orchestration.md")
        cls.verification = read("references/review-verification.md")
        cls.detection = read("references/detection.md")
        cls.concurrency = read("references/concurrency.md")
        cls.runtime_contract = read("references/runtime-contract.md")
        cls.technical = read("references/technical-recovery.md")
        cls.pointer = read("assets/pointer-template.md")

    def test_role_payloads_preserve_fresh_review_independence(self) -> None:
        roles = section(self.verification, "Independent review roles")
        state_bundles = section(self.orchestration, "State-bundle loading")
        for phrase in (
            "conclusion-blind persona reviewer",
            "sanitized current user directives without their dispositions",
            "Exclude the rest of the managed pointer block",
            "fresh **result falsifier**",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, roles)
        self.assertIn("no managed conclusions or prior review artifacts", state_bundles)
        self.assertIn("ROOT_PAYLOAD_KIND", state_bundles)
        self.assertIn("USER_INSTRUCTION_EPOCH", state_bundles)

    def test_host_wait_is_event_driven_and_controller_owns_leases(self) -> None:
        wait_contract = section(self.orchestration, "Host event wait contract")
        policy = fenced_json(wait_contract)
        self.assertEqual(600_000, policy["default_wait_min_ms"])
        self.assertEqual(1_800_000, policy["default_wait_max_ms"])
        self.assertGreaterEqual(
            policy["default_wait_ms"], policy["default_wait_min_ms"]
        )
        self.assertLessEqual(
            policy["default_wait_ms"], policy["default_wait_max_ms"]
        )
        self.assertEqual(0, policy["short_poll_repeats_allowed"])
        self.assertLess(
            policy["short_poll_threshold_ms"], policy["default_wait_min_ms"]
        )
        self.assertEqual(1, policy["status_probe_limit_per_controller"])
        self.assertGreater(
            policy["post_silence_probe_wait_max_ms"],
            policy["default_wait_max_ms"],
        )
        self.assertEqual("cycle-controller", policy["nested_lease_owner"])
        self.assertEqual(
            {
                "controller-terminal",
                "phase-transition",
                "failure-or-recovery",
                "material-progress",
                "user-interrupt",
            },
            set(policy["wake_events"]),
        )
        normalized_wait = normalize(wait_contract)
        self.assertIn("remaining real dispatch deadline", normalized_wait)
        self.assertIn("never substitutes for that deadline", normalized_wait)
        self.assertIn("never lease heartbeats", self.concurrency)
        self.assertIn(
            "an empty host wait never proves timeout",
            normalize(self.runtime_contract),
        )
        orchestrator = normalize(section(self.skill, "Orchestrator loop"))
        self.assertIn("Host event wait contract", orchestrator)
        controller = normalize(section(self.skill, "Cycle controller prompt"))
        self.assertIn("host-internal milestones", controller)
        self.assertIn("Never depend on main polling", controller)

    def test_source_changes_require_a_later_identical_fence(self) -> None:
        regression = section(
            self.verification, "Exact source fences and later-cycle regression watch"
        )
        convergence = section(self.skill, "Convergence and stop conditions")
        for phrase in (
            "leave each watch `open` in the change cycle",
            "`Cleared cycle` must be strictly greater than `Changed cycle`",
            "recomputed current source-fence triple",
            "give one fresh falsifier every open watch",
            "every required verdict is `passed` in that same later consuming cycle",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(normalize(phrase), normalize(regression))
        self.assertIn("strictly later current cycle against the identical recomputed current source", convergence)
        for field in (
            "Last material source-change cycle",
            "Last clean independent-review cycle",
            "Last regression-falsification cycle",
            "Last clean source fence",
            "Last regression source fence",
            "## Source fence ledger",
            "## Regression watch",
        ):
            with self.subTest(field=field):
                self.assertIn(field, self.pointer)

    def test_prompts_document_the_exact_shapes_the_reducer_requires(self) -> None:
        """The prompt-shape contract must be written down, not inferred.

        R55 asked every role for free-form `source-ref:path:line:symbol`
        evidence and for a `{watch_id, verdict, evidence, reasoning}` verdict.
        Both decode and are accepted, so nothing looked wrong -- but
        `_coverage_evidence_valid()` compares evidence tuples for equality and
        `carry_open_watches()` compares the verdict key set exactly, so every
        obligation silently reduced to a coverage gap and two watches that were
        genuinely verified could not clear. The reference never stated either
        shape, so this asserts the doc against the code that enforces it.
        """

        tokens = section(self.verification, "Coverage evidence tokens and regression verdicts")

        for prefix in evidence_token_prefixes():
            with self.subTest(prefix=prefix):
                self.assertIn(prefix, tokens)

        for key in regression_verdict_keys():
            with self.subTest(key=key):
                self.assertIn(key, tokens)

        for phrase in (
            "in the exact order `coverage_obligations_for_role()` returns",
            "sha256 of the exact fenced bytes",
            "is **not** an evidence token for any other",
            "`status` must be exactly `passed`",
            "`applicable: false`",
            "validated-result:<clearance_result_id>",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(normalize(phrase), normalize(tokens))

    def test_reducer_reports_the_allocated_cycle_not_the_recovery_budget_bound(
        self,
    ) -> None:
        """`TOTAL_CYCLE` is what the loop allocated, not what it may reach.

        R56 reported `total 58` while the pointer had allocated 56, because
        the reducer sealed `recovery_ledger._limit_cycle` -- the recovery
        budget's upper bound (`start_cycle + total_cycles - 1`) -- as
        `total_cycle`. A cycle budget bounds cycles; it is not a cycle count.
        The published number is the one a later `$rpf` invocation resumes
        from, so the conflation corrupts the resume point of every later run.
        """

        self.assertTrue(
            total_cycle_is_the_allocated_cycle(reducer_total_cycle_source())
        )
        for counterexample in (
            "recovery_ledger._limit_cycle",
            "recovery_ledger._start_cycle + recovery_ledger._total_cycles - 1",
            "root['cycle'] + recovery_ledger._total_cycles",
            "captured['recovery_snapshot']",
        ):
            with self.subTest(counterexample=counterexample):
                self.assertFalse(total_cycle_is_the_allocated_cycle(counterexample))

    def test_free_form_actions_are_preflighted_before_any_sink(self) -> None:
        deploy = section(self.detection, "Asking the user about deployment")
        gates = section(self.detection, "Quality gates")

        def contract(deploy_text: str, gate_text: str) -> bool:
            deploy_flat = normalize(deploy_text)
            gate_flat = normalize(gate_text)
            return all(
                (
                    "Do not include a free-form escape" in deploy_flat,
                    "noncaptured and pre-model sanitizing" in deploy_flat,
                    "approved repository mechanism" in deploy_flat,
                    "set `DEPLOY_MODE = none`" in deploy_flat,
                    ordered(gate_text, "secret-safe preflight", "then classify it"),
                    "structurally exact redacted action" in gate_flat,
                    "independently generated opaque incident ID" in gate_flat,
                    "non-value source metadata" in gate_flat,
                    "value-derived fingerprint" in gate_flat,
                )
            )

        self.assertTrue(contract(deploy, gates))
        counterexamples = (
            (deploy.replace("Do not include a free-form escape", "Include a free-form escape"), gates),
            (deploy.replace("noncaptured and pre-model sanitizing", "ordinary captured"), gates),
            (deploy.replace("approved repository mechanism", "plain reply"), gates),
            (deploy, gates.replace("then classify it", "after execution classify it")),
            (deploy, gates.replace("structurally exact redacted action", "raw action")),
            (deploy, gates.replace("independently generated opaque incident ID", "value hash")),
        )
        for unsafe_deploy, unsafe_gates in counterexamples:
            with self.subTest(counterexample=normalize(unsafe_deploy[-80:] + unsafe_gates[-80:])):
                self.assertFalse(contract(unsafe_deploy, unsafe_gates))

    def test_source_hashing_follows_metadata_then_allowlist(self) -> None:
        bundles = section(self.orchestration, "State-bundle loading")
        prefetch = section(self.orchestration, "Revision-fenced next-cycle prefetch")
        coverage = section(self.verification, "Reproducible inventory and coverage")

        def contract(bundle_text: str, hash_text: str, coverage_text: str) -> bool:
            return all(
                (
                    ordered(
                        bundle_text,
                        "path/index metadata only",
                        "repository-approved local redacting classifier",
                        "Freeze `SCOPE`",
                        "only then read those paths",
                    ),
                    "Freeze `SCOPE` from `approved` exact regular-file paths" in normalize(bundle_text),
                    "never read or hash it in agent context" in bundle_text,
                    "use only the already classified and frozen explicit approved-source" in hash_text,
                    "unapproved untracked path or suspected-secret path" in hash_text,
                    ordered(
                        coverage_text,
                        "inspect only path/index metadata",
                        "repository-approved local redacting classifier",
                        "Freeze only exact",
                        "every ordinary read calls `read_approved()`",
                    ),
                    "outside captured output and model context" in normalize(coverage_text),
                    "For `approved` only, it also returns the full" in coverage_text,
                    "For `protected`, `restricted`, or `uninspectable`, it" in coverage_text,
                    "including untracked but non-ignored files" not in hash_text,
                )
            )

        self.assertTrue(contract(bundles, prefetch, coverage))
        counterexamples = (
            (bundles.replace("path/index metadata only", "file contents first"), prefetch, coverage),
            (bundles.replace("repository-approved local redacting classifier", "model inspection"), prefetch, coverage),
            (bundles.replace("Freeze\n`SCOPE` from `approved` exact regular-file paths", "Freeze a discovered glob"), prefetch, coverage),
            (bundles.replace("never read or hash it in agent context", "read every candidate"), prefetch, coverage),
            (bundles, prefetch.replace("use only the already classified and frozen explicit approved-source", "expand every discovered glob"), coverage),
            (bundles, prefetch + " including untracked but non-ignored files", coverage),
        )
        for unsafe_bundle, unsafe_hash, unsafe_coverage in counterexamples:
            with self.subTest(counterexample=normalize(unsafe_bundle[-80:] + unsafe_hash[-80:])):
                self.assertFalse(contract(unsafe_bundle, unsafe_hash, unsafe_coverage))

        yaml_blocks = re.findall(r"```yaml\n(.*?)```", prefetch, flags=re.DOTALL)
        self.assertTrue(yaml_blocks)
        scope_lines = re.findall(r"^scope:\s*\[(.*)\]$", yaml_blocks[0], flags=re.MULTILINE)
        self.assertEqual(1, len(scope_lines))
        exact_paths = re.findall(r'"([^"]+)"', scope_lines[0])
        self.assertTrue(exact_paths)
        self.assertTrue(all("*" not in path and "?" not in path for path in exact_paths))
        unsafe_scope = scope_lines[0].replace("session.ts", "**")
        self.assertFalse(
            all("*" not in path and "?" not in path for path in re.findall(r'"([^"]+)"', unsafe_scope))
        )

    def test_falsifier_and_regression_evidence_relationships_fail_closed(self) -> None:
        roles = section(self.verification, "Independent review roles")
        regression = section(
            self.verification, "Exact source fences and later-cycle regression watch"
        )
        bundles = section(self.orchestration, "State-bundle loading")

        def contract(role_text: str, regression_text: str, bundle_text: str) -> bool:
            return all(
                (
                    "mandatory role projection" in role_text,
                    "immutable read access" in role_text,
                    "complete dispatched fence" in role_text,
                    "returned-fence validation" in role_text,
                    "source-grounded evidence" in role_text,
                    "every open watch" in regression_text,
                    "one fenced verdict for each changed contract, invariant, failure mode, and probe" in normalize(regression_text),
                    "same later consuming cycle" in regression_text,
                    "aggregate result falsifier" in bundle_text,
                    "regression falsifier" in bundle_text,
                )
            )

        self.assertTrue(contract(roles, regression, bundles))
        counterexamples = (
            (roles.replace("immutable read access", "mutable source access"), regression, bundles),
            (roles.replace("complete dispatched fence", "fence label"), regression, bundles),
            (roles.replace("source-grounded evidence", "unsupported assertion"), regression, bundles),
            (roles, regression.replace("every open watch", "a sample of watches"), bundles),
            (roles, regression.replace("same later consuming cycle", "any prior cycle"), bundles),
            (roles, regression, bundles.replace("aggregate result falsifier", "optional result checker")),
        )
        for bad_roles, bad_regression, bad_bundles in counterexamples:
            with self.subTest(counterexample=normalize(bad_roles[-80:] + bad_regression[-80:])):
                self.assertFalse(contract(bad_roles, bad_regression, bad_bundles))

        fence = VALID_FENCE
        captured = make_captured_state(
            2,
            "run-2",
            fence,
            watches=[
                {"id": "RW-1", "status": "open", "changed_cycle": 1, "fence": fence},
                {"id": "RW-2", "status": "open", "changed_cycle": 1, "fence": fence},
            ],
        )
        passed = [("RW-1", "passed", 2, fence), ("RW-2", "passed", 2, fence)]
        self.assertTrue(regression_verdicts_pass(captured, passed, 2, "run-2", fence))
        for invalid in (
            passed[:1],
            passed + [passed[0]],
            passed + [("RW-3", "passed", 2, fence)],
            [("RW-1", "failed", 2, fence), passed[1]],
            [("RW-1", "passed", 1, fence), passed[1]],
            [("RW-1", "passed", 2, OTHER_FENCE), passed[1]],
            [("RW-1", "passed", 2, fence), ("RW-2", "passed", 3, fence)],
        ):
            with self.subTest(invalid_verdict_rows=invalid):
                self.assertFalse(regression_verdicts_pass(captured, invalid, 2, "run-2", fence))

    def test_fence_aliases_are_lifetime_unique_and_conflicts_block(self) -> None:
        fence_schema = section(self.pointer, "Source fence ledger")
        merge = section(self.concurrency, "Merge rules")

        def contract(schema_text: str, merge_text: str) -> bool:
            schema_text = normalize(schema_text)
            merge_text = normalize(merge_text)
            return all(
                (
                    "immutable one-to-one alias" in schema_text,
                    "exactly one ID names one canonical exact triple" in schema_text,
                    "Divergent or duplicate aliases block publication" in schema_text,
                    "one ID per triple and one triple per ID" in merge_text,
                    "second alias for a triple" in merge_text,
                    "blocks merge/publication" in merge_text,
                    "compare the complete canonical triple" in merge_text,
                )
            )

        self.assertTrue(contract(fence_schema, merge))
        flat_schema = normalize(fence_schema)
        flat_merge = normalize(merge)
        counterexamples = (
            (flat_schema.replace("immutable one-to-one alias", "mutable label"), flat_merge),
            (flat_schema.replace("Divergent or duplicate aliases block publication", "last alias wins"), flat_merge),
            (flat_schema, flat_merge.replace("one ID per triple and one triple per ID", "any ID may name any triple")),
            (flat_schema, flat_merge.replace("blocks merge/publication", "uses the newest row")),
            (flat_schema, flat_merge.replace("compare the complete canonical triple", "compare the alias label")),
        )
        for bad_schema, bad_merge in counterexamples:
            with self.subTest(counterexample=normalize(bad_schema[-80:] + bad_merge[-80:])):
                self.assertFalse(contract(bad_schema, bad_merge))

        source = dict(LEGACY_SOURCE_BYTES)
        scope_a = [SOURCE_PATH]
        hash_a = scope_digest(scope_a, source)
        approved_a = (VALID_FENCE[0], tuple(scope_a), hash_a)
        row_a = ("F-1", VALID_FENCE[0], scope_a, hash_a, "current-convergence")
        self.assertTrue(fence_aliases_valid([row_a, row_a], source, approved_a))
        self.assertFalse(
            fence_aliases_valid(
                [row_a, ("F-1", "b" * 40, scope_a, hash_a, "current-convergence")],
                source,
                approved_a,
            )
        )
        self.assertFalse(
            fence_aliases_valid(
                [row_a, ("F-2", VALID_FENCE[0], scope_a, hash_a, "current-convergence")],
                source,
                approved_a,
            )
        )
        for bad in (
            ("F-1", "base", scope_a, hash_a, "current-convergence"),
            ("F-1", "a" * 40, [], hashlib.sha256(b"").hexdigest(), "current-convergence"),
            ("F-1", "a" * 40, ["../a.txt"], hash_a, "current-convergence"),
            ("F-1", "a" * 40, ["*.txt"], hash_a, "current-convergence"),
            ("F-1", "a" * 40, scope_a, "0" * 64, "current-convergence"),
            ("F-1", "PRE-CONTRACT", scope_a, hash_a, "current-convergence"),
        ):
            with self.subTest(invalid_canonical_fence=bad):
                self.assertFalse(fence_aliases_valid([bad], source, approved_a))
        self.assertFalse(fence_aliases_valid(None, source, approved_a))  # type: ignore[arg-type]
        self.assertFalse(fence_aliases_valid([()], source, approved_a))  # type: ignore[list-item]
        self.assertFalse(
            fence_aliases_valid(
                [("F-1", VALID_FENCE[0], [1], hash_a, "current-convergence")],  # type: ignore[list-item]
                source,
                approved_a,
            )
        )
        for control_path in ("bad\x00.txt", "bad\x1f.txt", "bad\x7f.txt"):
            control_source = {control_path: b"x"}
            control_hash = scope_digest([control_path], control_source)
            control_approved = ("a" * 40, (control_path,), control_hash)
            self.assertIsNone(canonical_source_triple("a" * 40, [control_path], control_hash, control_source, control_approved))

    def test_required_role_and_summary_reducers_fail_closed(self) -> None:
        roster = section(self.pointer, "Required role evidence")
        reducers = self.concurrency.split("### Evidence reducers", 1)[1].split(
            "## Review-input revisions", 1
        )[0]

        def contract(roster_text: str, reducer_text: str) -> bool:
            roster_text = normalize(roster_text)
            reducer_text = normalize(reducer_text)
            return all(
                (
                    "Close the roster before dispatch" in roster_text,
                    "`Required` is `yes` or `no`" in roster_text,
                    all(
                        status in roster_text
                        for status in (
                            "`passed`",
                            "`findings`",
                            "`failed`",
                            "`incomplete`",
                            "`restricted`",
                            "`not-applicable`",
                        )
                    ),
                    "consuming current completed `TOTAL_CYCLE`" in reducer_text,
                    "Close the required-role roster before dispatch" in reducer_text,
                    "Conservative worst-to-best order" in reducer_text,
                    all(
                        state in reducer_text
                        for state in (
                            "Missing",
                            "non-identical duplicate",
                            "ambiguous",
                            "incomplete",
                            "restricted",
                            "failed",
                            "fence-mismatched",
                        )
                    ),
                    "always fails closed" in reducer_text,
                    "never scalar text" in reducer_text,
                    "independent review remains `incomplete`" in reducer_text,
                )
            )

        self.assertTrue(contract(roster, reducers))
        flat_roster = normalize(roster)
        flat_reducers = normalize(reducers)
        counterexamples = (
            (flat_roster.replace("Close the roster before dispatch", "Derive before closing the roster"), flat_reducers),
            (flat_roster.replace("`Required` is `yes` or `no`", "Required is free-form"), flat_reducers),
            (flat_roster, flat_reducers.replace("consuming current completed `TOTAL_CYCLE`", "any available cycle")),
            (flat_roster, flat_reducers.replace("Conservative worst-to-best order", "best status wins")),
            (flat_roster, flat_reducers.replace("non-identical duplicate", "duplicate ignored")),
            (flat_roster, flat_reducers.replace("always fails closed", "may pass")),
            (flat_roster, flat_reducers.replace("never scalar text", "prefer scalar text")),
        )
        for bad_roster, bad_reducers in counterexamples:
            with self.subTest(counterexample=normalize(bad_roster[-80:] + bad_reducers[-80:])):
                self.assertFalse(contract(bad_roster, bad_reducers))

        self.assertEqual("incomplete", reduce_independent_review([]))
        self.assertEqual("clean", reduce_independent_review(["passed", "passed"]))
        self.assertEqual("findings", reduce_independent_review(["passed", "findings"]))
        for statuses in (
            ["failed"],
            ["restricted"],
            ["incomplete"],
            ["passed", "failed"],
            ["passed", "unknown"],
        ):
            with self.subTest(required_statuses=statuses):
                self.assertEqual("incomplete", reduce_independent_review(statuses))

        fence = VALID_FENCE
        required_roles = {
            "conclusion-blind-persona:security",
            "conclusion-blind-persona:testing",
            "pointer-alignment",
            "plan-doc-consistency",
            "aggregate-result-falsifier",
        }
        valid_rows = [
            ("ROLE-1", "conclusion-blind-persona:security", "yes", "passed", fence),
            ("ROLE-2", "conclusion-blind-persona:testing", "yes", "passed", fence),
            ("ROLE-3", "pointer-alignment", "yes", "passed", fence),
            ("ROLE-4", "plan-doc-consistency", "yes", "passed", fence),
            ("ROLE-5", "aggregate-result-falsifier", "yes", "passed", fence),
            ("ROLE-6", "optional-repository-role", "no", "not-applicable", fence),
        ]
        captured = make_captured_state(3, "run-3", fence)
        self.assertEqual(
            "clean", reduce_required_role_roster(valid_rows, fence, captured)
        )
        finding_rows = list(valid_rows)
        finding_rows[0] = (*finding_rows[0][:3], "findings", fence)
        self.assertEqual(
            "findings", reduce_required_role_roster(finding_rows, fence, captured)
        )
        invalid_rosters = (
            valid_rows[:-2] + valid_rows[-1:],
            [row for row in valid_rows if row[1] != "conclusion-blind-persona:testing"],
            valid_rows + [valid_rows[0]],
            valid_rows + [("ROLE-7", "conclusion-blind-persona:security", "yes", "passed", fence)],
            valid_rows + [("ROLE-7", "unexpected-required-role", "yes", "passed", fence)],
            [(row[0], row[1], "no" if row[1] == "pointer-alignment" else row[2], row[3], row[4]) for row in valid_rows],
            [(row[0], row[1], row[2], row[3], OTHER_FENCE) if row[1] == "pointer-alignment" else row for row in valid_rows],
            [(row[0], row[1], row[2], "unknown", row[4]) if row[1] == "pointer-alignment" else row for row in valid_rows],
            [("", *valid_rows[0][1:])] + valid_rows[1:],
            [(row[0], row[1], "maybe" if row[1] == "pointer-alignment" else row[2], row[3], row[4]) for row in valid_rows],
        )
        for invalid_rows in invalid_rosters:
            with self.subTest(invalid_roster=invalid_rows):
                self.assertEqual(
                    "incomplete",
                    reduce_required_role_roster(invalid_rows, fence, captured),
                )
        injected_capture = make_captured_state(
            3,
            "run-3",
            fence,
            selected_personas=["security", "testing", "privacy"],
        )
        self.assertEqual(
            "incomplete",
            reduce_required_role_roster(valid_rows, fence, injected_capture),
        )
        due_captured = make_captured_state(
            3,
            "run-3",
            fence,
            watches=[{"id": "RW-1", "status": "open", "changed_cycle": 2, "fence": fence}],
        )
        self.assertEqual(
            "incomplete",
            reduce_required_role_roster(valid_rows, fence, due_captured),
        )
        all_due = make_captured_state(
            3,
            "run-3",
            fence,
            repository_roles=["repo-audit"],
            watches=[{"id": "RW-1", "status": "open", "changed_cycle": 2, "fence": fence}],
            contracts={"SC-1": {"name": "contract", "changed": True, "still_current": True}},
            gates=[{"id": "G-1", "classification": "not-run-prohibited", "affected_contract_ids": ["SC-1"], "fence": fence}],
            ui_mapping={f"UI-{kind}": kind for kind in runtime.UI_KINDS},
        )
        self.assertEqual(
            CORE_REQUIRED_ROLES
            | {"regression-falsifier", "source-contract-verifier", "ui-runtime-verifier", "repo-audit"},
            derive_required_roles(all_due, 3, "run-3", fence),
        )

    def test_conditional_publication_and_gate_snapshots_are_executable(self) -> None:
        publication = section(self.concurrency, "Conflict-preserving publication")

        def publication_contract(text: str) -> bool:
            flat = normalize(text).lower()
            return all(
                phrase in flat
                for phrase in (
                    "requires conflict-preserving native exchange",
                    "never publication authority",
                    "every nonrestricted `base`, `current`, and `candidate`",
                    "let the agent choose a conservative merge",
                    "ask the user when authored goal/policy",
                    "unrelated safe work may continue",
                )
            ) and "cooperative-replace" not in flat

        self.assertTrue(publication_contract(publication))
        self.assertFalse(
            publication_contract(publication + " cooperative-replace")
        )
        self.assertEqual("published-atomic-exchange", conditional_publication_result("id-1", "id-1", True))
        self.assertEqual("reconcile-preserve-base-current-candidate", conditional_publication_result("id-1", "id-2", True))
        self.assertEqual("deferred-provider-unavailable", conditional_publication_result("id-1", "id-1", False))

        fence = VALID_FENCE
        gate_sha = "c" * 40
        snapshot_hash = "d" * 64
        identity = "snapshot-immutable-1"
        commit = [{"command": "unit", "status": "passed", "fence": fence, "head_after": gate_sha, "gate_snapshot": {"kind": "commit", "sha": gate_sha, "fence": fence, "identity": identity, "source_hash": snapshot_hash, "post_run_identity": identity}}]
        self.assertTrue(gate_results_green(commit, {"unit"}, gate_sha, fence, identity, snapshot_hash))
        for malformed_rows in (
            [{}],
            [{"command": "unit"}],
            [{"status": "passed", "fence": fence, "gate_snapshot": {}}],
            [{"command": 7, "status": "passed", "fence": fence, "gate_snapshot": {}}],
            [None],
            ["malformed"],
        ):
            with self.subTest(malformed_gate_rows=malformed_rows):
                self.assertFalse(
                    gate_results_green(
                        malformed_rows, {"unit"}, gate_sha, fence, identity, snapshot_hash
                    )
                )
        self.assertFalse(gate_results_green(commit, {"unit"}, "bogus", fence, identity, snapshot_hash))
        self.assertFalse(gate_results_green([{**commit[0], "head_after": "bogus"}], {"unit"}, gate_sha, fence, identity, snapshot_hash))
        self.assertFalse(gate_results_green([{**commit[0], "gate_snapshot": {**commit[0]["gate_snapshot"], "sha": "bogus"}}], {"unit"}, gate_sha, fence, identity, snapshot_hash))
        authorized = [{"command": "unit", "status": "passed", "fence": fence, "gate_snapshot": {"kind": "authorized-commit-prohibited", "authority": "repo-policy:1", "isolated": True, "before": snapshot_hash, "after": snapshot_hash, "fence": fence, "identity": identity, "source_hash": snapshot_hash, "post_run_identity": identity}}]
        self.assertTrue(gate_results_green(authorized, {"unit"}, gate_sha, fence, identity, snapshot_hash))
        for bad in (
            [{**authorized[0], "fence": ("e" * 40, "src/a.py", "b" * 64)}],
            [{**authorized[0], "gate_snapshot": {**authorized[0]["gate_snapshot"], "before": ""}}],
            [{**authorized[0], "gate_snapshot": {**authorized[0]["gate_snapshot"], "after": "e" * 64}}],
            [{**authorized[0], "gate_snapshot": {**authorized[0]["gate_snapshot"], "fence": ("e" * 40, "src/a.py", "b" * 64)}}],
            [{**authorized[0], "gate_snapshot": {**authorized[0]["gate_snapshot"], "post_run_identity": "mutated"}}],
            [{**authorized[0], "gate_snapshot": {**authorized[0]["gate_snapshot"], "kind": "mutable-working-tree"}}],
        ):
            self.assertFalse(gate_results_green(bad, {"unit"}, gate_sha, fence, identity, snapshot_hash))

    def test_public_reducers_reject_malformed_nested_inputs_without_exceptions(self) -> None:
        fence = VALID_FENCE
        captured = make_captured_state(3, "run-3", fence)
        due_capture = make_captured_state(
            3,
            "run-3",
            fence,
            watches=[
                {"id": "RW-1", "status": "open", "changed_cycle": 2, "fence": fence}
            ],
        )
        cases = (
            ("review nested list", lambda: reduce_independent_review([[]]), "incomplete"),
            ("review wrong container", lambda: reduce_independent_review(None), "incomplete"),
            ("backup non-dict row", lambda: backup_restore_evidence_valid(None, {}), False),
            ("backup partial row", lambda: backup_restore_evidence_valid({}, {}), False),
            ("roster non-dict row", lambda: reduce_required_role_roster([None], fence, captured), "incomplete"),
            ("roster wrong container", lambda: reduce_required_role_roster(None, fence, captured), "incomplete"),
            ("regression wrong container", lambda: regression_verdicts_pass(due_capture, None, 3, "run-3", fence), False),
            ("regression partial row", lambda: regression_verdicts_pass(due_capture, [("RW-1",)], 3, "run-3", fence), False),
            ("quarantine nested list", lambda: quarantined_item_count([("restricted", [[]])], set()), None),
            ("quarantine wrong container", lambda: quarantined_item_count(None, set()), None),
            (
                "dispatch roster wrong container",
                lambda: required_dispatch_coverage_complete(
                    set(), None, [], {}, {}, [], 3, "run-3", fence, captured
                ),
                False,
            ),
            (
                "dispatch unhashable role",
                lambda: required_dispatch_coverage_complete(
                    {"role"},
                    [{"role": [], "required": "yes", "dispatch": "dispatch"}],
                    [],
                    {},
                    {},
                    [],
                    3,
                    "run-3",
                    fence,
                    captured,
                ),
                False,
            ),
            (
                "dispatch caller role subset",
                lambda: required_dispatch_coverage_complete(
                    CORE_REQUIRED_ROLES - {"pointer-alignment"},
                    [], [], {}, {}, [], 3, "run-3", fence, captured,
                ),
                False,
            ),
            (
                "dispatch caller role extra",
                lambda: required_dispatch_coverage_complete(
                    CORE_REQUIRED_ROLES | {"caller-extra"},
                    [], [], {}, {}, [], 3, "run-3", fence, captured,
                ),
                False,
            ),
            ("convergence non-row", lambda: convergence_rows_unambiguous([None]), False),
            ("convergence partial row", lambda: convergence_rows_unambiguous([("ID",)]), False),
            ("convergence empty", lambda: convergence_rows_unambiguous([]), False),
        )
        for name, reducer, expected in cases:
            with self.subTest(malformed_case=name):
                self.assertEqual(expected, reducer())

    def test_authority_enums_and_fence_members_fail_closed_before_membership(self) -> None:
        fence = VALID_FENCE
        cycle, run = 3, "run-3"
        watch_capture = make_captured_state(
            cycle,
            run,
            fence,
            watches=[
                {"id": "RW-1", "status": [], "changed_cycle": 2, "fence": fence}
            ],
        )
        gate_capture = make_captured_state(
            cycle,
            run,
            fence,
            gates=[
                {
                    "id": "G-1",
                    "classification": [],
                    "affected_contract_ids": [],
                    "fence": fence,
                }
            ],
        )
        ui_capture = make_captured_state(
            cycle, run, fence, ui_mapping={"UI-bad": []}
        )
        runtime_capture = make_captured_state(
            cycle,
            run,
            fence,
            runtime_records={
                "EXEC-1": {
                    "id": "EXEC-1", "immutable": True, "cycle": cycle,
                    "run": run, "fence": fence, "runner": "browser",
                    "snapshot_id": "snapshot", "command": "ui-check",
                    "action": "open", "expected": "usable", "observed": "usable",
                    "result": [],
                }
            },
        )
        backup_capture = make_captured_state(
            cycle,
            run,
            fence,
            backup_records={
                "BACKUP-1": {
                    "id": "BACKUP-1", "immutable": True, "cycle": cycle,
                    "run": run, "fence": fence, "kind": [], "endpoint": "export",
                    "schema": "s", "version": "1", "content": "c", "ordering": "o",
                }
            },
        )
        for malformed_capture in (
            watch_capture, gate_capture, ui_capture, runtime_capture, backup_capture
        ):
            self.assertIsNone(
                authoritative_captured_projection(
                    malformed_capture, cycle, run, fence
                )
            )

        gate_sha = "c" * 40
        snapshot_hash = "d" * 64
        identity = "snapshot-immutable-1"
        malformed_gate_fence = ("a" * 40, [], "b" * 64)
        malformed_gate = [{
            "command": "unit", "status": "passed", "fence": malformed_gate_fence,
            "head_after": gate_sha,
            "gate_snapshot": {
                "kind": "commit", "sha": gate_sha, "fence": malformed_gate_fence,
                "identity": identity, "source_hash": snapshot_hash,
                "post_run_identity": identity,
            },
        }]
        self.assertFalse(
            gate_results_green(
                malformed_gate, {"unit"}, gate_sha, malformed_gate_fence,
                identity, snapshot_hash,
            )
        )

        malformed_role_fence = ("base", {}, "hash")
        malformed_role_capture = make_captured_state(
            cycle, run, malformed_role_fence
        )
        malformed_role_rows = [
            (f"ROLE-{index}", role, "yes", "passed", malformed_role_fence)
            for index, role in enumerate(sorted(CORE_REQUIRED_ROLES), 1)
        ]
        self.assertEqual(
            "incomplete",
            reduce_required_role_roster(
                malformed_role_rows, malformed_role_fence, malformed_role_capture
            ),
        )

        malformed_watch_capture = make_captured_state(
            cycle,
            run,
            fence,
            watches=[
                {
                    "id": "RW-1", "status": "open", "changed_cycle": 2,
                    "fence": ("base", set(), "hash"),
                }
            ],
        )
        self.assertFalse(
            regression_verdicts_pass(
                malformed_watch_capture,
                [("RW-1", "passed", cycle, fence)],
                cycle,
                run,
                fence,
            )
        )

    def test_current_cycle_dispatch_and_regression_inputs_fail_closed(self) -> None:
        fence = VALID_FENCE
        prior_fence = OTHER_FENCE
        cycle, run = 3, "run-3"
        captured = make_captured_state(cycle, run, fence)
        histories = {name: [] for name in ("required-role", "review-result", "coverage", "aggregate-result", "regression", "source-contract", "ui", "gate-result")}
        roster: list[dict[str, object]] = []
        coverage: list[dict[str, object]] = []
        results: list[dict[str, object]] = []
        specialized: list[dict[str, object]] = []
        preallocated: dict[str, list[str]] = {}
        role_obligations: dict[str, list[tuple[str, str]]] = {}
        next_cov = 1
        for index, role in enumerate(sorted(CORE_REQUIRED_ROLES), 1):
            dispatch = f"dispatch-{index}"
            extra = [("probe", f"claim:{role}")]
            ids = preallocate_coverage_ids(next_cov, len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + len(extra))
            next_cov += len(ids)
            expected = authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), ids, dispatch, [], extra)
            preallocated[dispatch] = ids
            role_obligations[role] = extra
            for coverage_id, (kind, obligation) in expected.items():
                coverage.append({"id": coverage_id, "kind": kind, "obligation": obligation, "cycle": cycle, "run": run, "dispatch": dispatch, "fence": fence, "disposition": "covered" if kind == "inventory" or obligation.startswith("claim:") else "not-applicable", "evidence": f"evidence:{obligation}", "reason": "", "gap": ""})
            detail_ids: list[str] = []
            if role == "aggregate-result-falsifier":
                detail_ids = ["opaque-detail-7"]
                specialized.append({"id": detail_ids[0], "type": "aggregate", "cycle": cycle, "run": run, "dispatch": dispatch, "fence": fence, "status": "passed", "coverage_ids": list(ids), "source_grounded_evidence": "aggregate-source"})
            roster.append({"cycle": cycle, "run": run, "role_id": f"ROLE-{index}", "dispatch": dispatch, "role": role, "required": "yes", "fence": fence, "status": "passed", "coverage_ids": list(ids), "result_id": f"RES-{index}"})
            results.append({"id": f"RES-{index}", "cycle": cycle, "run": run, "role_id": f"ROLE-{index}", "dispatch": dispatch, "fence": fence, "required_status": "yes", "status": "passed", "counterexample_search": f"searched:{role}", "source_grounded_evidence": f"source:{role}", "coverage_ids": list(ids), "specialized_detail_ids": detail_ids})

        def roster_result(
            candidate_roster: list[dict[str, object]] = roster,
            candidate_coverage: list[dict[str, object]] = coverage,
            candidate_results: list[dict[str, object]] = results,
            candidate_histories: dict[str, list[dict[str, object]]] = histories,
            candidate_specialized: list[dict[str, object]] = specialized,
            candidate_preallocated: dict[str, list[str]] = preallocated,
        ) -> str:
            return current_roster_result(candidate_roster, candidate_coverage, candidate_results, cycle, run, fence, candidate_histories, candidate_specialized, captured, candidate_preallocated, role_obligations)

        self.assertEqual("clean", roster_result())
        self.assertEqual("incomplete", roster_result(candidate_roster=[*roster, {}]))
        self.assertEqual("incomplete", roster_result(candidate_coverage=[*coverage, {}]))
        self.assertEqual("incomplete", roster_result(candidate_results=[*results, {}]))
        self.assertEqual("incomplete", roster_result(candidate_specialized=[*specialized, {}]))
        self.assertEqual(
            "incomplete",
            roster_result(candidate_roster=[{**roster[0], "role_id": []}, *roster[1:]]),
        )
        self.assertEqual(
            "incomplete",
            roster_result(
                candidate_roster=[{**roster[0], "coverage_ids": [[]]}, *roster[1:]]
            ),
        )
        self.assertEqual(
            "incomplete",
            roster_result(candidate_coverage=[{**coverage[0], "id": []}, *coverage[1:]]),
        )
        self.assertEqual(
            "incomplete",
            roster_result(candidate_results=[{**results[0], "id": []}, *results[1:]]),
        )
        self.assertEqual(
            "incomplete",
            roster_result(
                candidate_specialized=[{**specialized[0], "id": []}, *specialized[1:]]
            ),
        )
        for history_name in histories:
            with self.subTest(malformed_history=history_name):
                malformed_histories = {**histories, history_name: [{}]}
                self.assertEqual(
                    "incomplete", roster_result(candidate_histories=malformed_histories)
                )
                wrong_type_histories = {
                    **histories,
                    history_name: [
                        {"cycle": "older", "run": "older-run", "dispatch": "older-dispatch"}
                    ],
                }
                self.assertEqual(
                    "incomplete", roster_result(candidate_histories=wrong_type_histories)
                )
        optional_role = {"cycle": cycle, "run": run, "role_id": "ROLE-O", "dispatch": "dispatch-o", "role": "optional-repository-role", "required": "no", "fence": fence, "status": "not-applicable", "coverage_ids": ["COV-9999"], "result_id": "RES-O"}
        optional_coverage = {"id": "COV-9999", "kind": "inventory", "obligation": "optional:surface", "cycle": cycle, "run": run, "dispatch": "dispatch-o", "fence": fence, "disposition": "not-applicable", "evidence": "metadata:none"}
        optional_result = {"id": "RES-O", "cycle": cycle, "run": run, "role_id": "ROLE-O", "dispatch": "dispatch-o", "fence": fence, "required_status": "no", "status": "not-applicable", "counterexample_search": "metadata applicability", "source_grounded_evidence": "metadata:none", "coverage_ids": ["COV-O"], "specialized_detail_ids": []}
        optional_result["coverage_ids"] = ["COV-9999"]
        self.assertEqual("clean", roster_result(roster + [optional_role], coverage + [optional_coverage], results + [optional_result]))
        self.assertEqual("incomplete", roster_result(roster[:-1]))
        due_captured = make_captured_state(
            cycle,
            run,
            fence,
            watches=[{"id": "RW-extra", "status": "open", "changed_cycle": cycle - 1, "fence": fence}],
        )
        self.assertEqual("incomplete", current_roster_result(roster, coverage, results, cycle, run, fence, histories, specialized, due_captured, preallocated, role_obligations))
        bad_preallocated = {**preallocated, roster[1]["dispatch"]: list(preallocated[roster[0]["dispatch"]])}
        self.assertEqual("incomplete", roster_result(candidate_preallocated=bad_preallocated))
        categorical = {**preallocated, roster[0]["dispatch"]: ["COV-I-1", *preallocated[roster[0]["dispatch"]][1:]]}
        self.assertEqual("incomplete", roster_result(candidate_preallocated=categorical))
        reused_history = {**histories, "coverage": [{"id": preallocated[roster[0]["dispatch"]][0], "dispatch": "older-dispatch"}]}
        self.assertEqual("incomplete", roster_result(candidate_histories=reused_history))
        reused_role_history = {
            **histories,
            "required-role": [
                {
                    "role_id": roster[0]["role_id"],
                    "cycle": cycle - 1,
                    "run": "older-run",
                    "dispatch": "older-dispatch",
                }
            ],
        }
        self.assertEqual("incomplete", roster_result(candidate_histories=reused_role_history))
        reused_review_role_history = {
            **histories,
            "review-result": [
                {
                    "id": "RES-OLD",
                    "role_id": roster[0]["role_id"],
                    "cycle": cycle - 1,
                    "run": "older-run",
                    "dispatch": "older-dispatch",
                }
            ],
        }
        self.assertEqual(
            "incomplete", roster_result(candidate_histories=reused_review_role_history)
        )
        reused_result_history = {
            **histories,
            "review-result": [
                {
                    "id": roster[0]["result_id"],
                    "role_id": "ROLE-OLD",
                    "cycle": cycle - 1,
                    "run": "older-run",
                    "dispatch": "older-dispatch",
                }
            ],
        }
        self.assertEqual("incomplete", roster_result(candidate_histories=reused_result_history))
        self.assertEqual("incomplete", roster_result(candidate_coverage=coverage[:-1]))
        self.assertEqual("incomplete", roster_result(candidate_coverage=coverage + [{**coverage[0], "id": "COV-9998"}]))
        self.assertEqual("incomplete", roster_result(candidate_results=[{**results[0], "source_grounded_evidence": ""}, *results[1:]]))
        self.assertEqual("incomplete", roster_result(candidate_specialized=[{**specialized[0], "fence": prior_fence}]))

        watches = [
            {"id": "RW-1", "status": "open", "changed_cycle": 2, "fence": fence},
            {"id": "RW-2", "status": "open", "changed_cycle": 2, "fence": fence},
        ]
        regression_captured = make_captured_state(cycle, run, fence, watches=watches)
        regression_extra = [("probe", "watch:RW-1"), ("probe", "watch:RW-2")]
        regression_allocated = preallocate_coverage_ids(
            600,
            len(RPF_SOURCE_SURFACES)
            + len(GAME_FAMILIES)
            + len(INCIDENT_FAMILIES)
            + len(regression_extra),
        )
        regression_expected = authoritative_coverage_mapping(
            list(RPF_SOURCE_SURFACES),
            regression_allocated,
            "dispatch-r",
            [],
            regression_extra,
        )
        watch_coverage_ids = {
            obligation.removeprefix("watch:"): coverage_id
            for coverage_id, (_, obligation) in regression_expected.items()
            if obligation.startswith("watch:")
        }
        regression_coverage = [
            {
                "id": coverage_id,
                "kind": kind,
                "obligation": obligation,
                "disposition": (
                    "covered"
                    if kind == "inventory" or obligation.startswith("watch:")
                    else "not-applicable"
                ),
                "evidence": f"src:{obligation}",
                "reason": "",
                "gap": "",
                "cycle": cycle,
                "run": run,
                "dispatch": "dispatch-r",
                "fence": fence,
            }
            for coverage_id, (kind, obligation) in regression_expected.items()
        ]
        verdicts = [
            {"id": "RV-1", "watch_id": "RW-1", "status": "passed", "counterexample_search": "probe RW-1", "source_grounded_evidence": "src:rw1", "cycle": cycle, "run": run, "dispatch": "dispatch-r", "fence": fence, "coverage_id": watch_coverage_ids["RW-1"]},
            {"id": "RV-2", "watch_id": "RW-2", "status": "passed", "counterexample_search": "probe RW-2", "source_grounded_evidence": "src:rw2", "cycle": cycle, "run": run, "dispatch": "dispatch-r", "fence": fence, "coverage_id": watch_coverage_ids["RW-2"]},
        ]
        persona = {"status": "clean", "cycle": cycle, "run": run, "fence": fence}
        regression_role = {"role": "regression-falsifier", "required": "yes", "status": "passed", "cycle": cycle, "run": run, "dispatch": "dispatch-r", "fence": fence, "verdict_ids": ["RV-1", "RV-2"], "coverage_ids": list(regression_allocated)}
        self.assertTrue(current_regression_passes(regression_captured, verdicts, persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(
            current_regression_passes(
                {**regression_captured, "regression_watches": [{**watches[0], "id": []}, watches[1]]},
                verdicts,
                persona,
                regression_role,
                set(),
                regression_coverage,
                regression_expected,
                cycle,
                run,
                fence,
            )
        )
        self.assertFalse(
            current_regression_passes(
                regression_captured,
                verdicts,
                persona,
                {**regression_role, "coverage_ids": [[]]},
                set(),
                regression_coverage,
                regression_expected,
                cycle,
                run,
                fence,
            )
        )
        self.assertFalse(
            current_regression_passes(
                regression_captured,
                verdicts,
                persona,
                regression_role,
                set(),
                [{**regression_coverage[0], "id": []}, *regression_coverage[1:]],
                regression_expected,
                cycle,
                run,
                fence,
            )
        )
        stale_f1_watches = [{**watch, "fence": prior_fence} for watch in watches]
        stale_captured = {**regression_captured, "regression_watches": stale_f1_watches}
        stale_f1_verdicts = [{**verdict, "fence": prior_fence} for verdict in verdicts]
        self.assertFalse(current_regression_passes(stale_captured, stale_f1_verdicts, persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(current_regression_passes(regression_captured, verdicts, {**persona, "status": "findings"}, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(current_regression_passes(regression_captured, [{**verdicts[0], "cycle": 2}, verdicts[1]], persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(current_regression_passes(regression_captured, [verdicts[0], {**verdicts[1], "id": "RV-1"}], persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(current_regression_passes(regression_captured, [verdicts[0], {**verdicts[1], "coverage_id": watch_coverage_ids["RW-1"]}], persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        self.assertFalse(current_regression_passes(regression_captured, verdicts, persona, regression_role, {"dispatch-r"}, regression_coverage, regression_expected, cycle, run, fence))
        for invalid_role in (
            {},
            {**regression_role, "role": "aggregate-result-falsifier"},
            {**regression_role, "cycle": cycle - 1},
            {**regression_role, "dispatch": "other-dispatch"},
            {**regression_role, "verdict_ids": ["RV-1"]},
            {**regression_role, "coverage_ids": regression_allocated[:-1]},
        ):
            with self.subTest(invalid_regression_role=invalid_role):
                self.assertFalse(current_regression_passes(regression_captured, verdicts, persona, invalid_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        for duplicate_links in (
            {**regression_role, "verdict_ids": ["RV-1", "RV-1", "RV-2"]},
            {**regression_role, "coverage_ids": [*regression_allocated, regression_allocated[-1]]},
        ):
            with self.subTest(duplicate_regression_links=duplicate_links):
                self.assertFalse(current_regression_passes(regression_captured, verdicts, persona, duplicate_links, set(), regression_coverage, regression_expected, cycle, run, fence))
        for bad_verdicts in (
            [{**verdicts[0], "counterexample_search": ""}, verdicts[1]],
            [{**verdicts[0], "source_grounded_evidence": ""}, verdicts[1]],
        ):
            self.assertFalse(current_regression_passes(regression_captured, bad_verdicts, persona, regression_role, set(), regression_coverage, regression_expected, cycle, run, fence))
        for bad_coverage in (
            [{**regression_coverage[0], "obligation": "wrong"}, *regression_coverage[1:]],
            [{**regression_coverage[0], "disposition": "applicable"}, *regression_coverage[1:]],
            [{**regression_coverage[0], "evidence": ""}, *regression_coverage[1:]],
        ):
            self.assertFalse(current_regression_passes(regression_captured, verdicts, persona, regression_role, set(), bad_coverage, regression_expected, cycle, run, fence))
        watch_only = [row for row in regression_coverage if str(row["obligation"]).startswith("watch:")]
        watch_only_expected = {
            str(row["id"]): (str(row["kind"]), str(row["obligation"])) for row in watch_only
        }
        self.assertFalse(
            current_regression_passes(
                regression_captured,
                verdicts,
                persona,
                {**regression_role, "coverage_ids": list(watch_only_expected)},
                set(),
                watch_only,
                watch_only_expected,
                cycle,
                run,
                fence,
            )
        )

    def test_captured_authority_derives_due_watch_and_contract_obligations(self) -> None:
        fence = VALID_FENCE
        cycle, run = 4, "run-4"
        captured = make_captured_state(
            cycle,
            run,
            fence,
            repository_roles=["repo-audit"],
            watches=[
                {"id": "RW-1", "status": "open", "changed_cycle": 2, "fence": fence},
                {"id": "RW-extra", "status": "open", "changed_cycle": 3, "fence": fence},
            ],
            contracts={
                "SC-1": {"name": "changed contract", "changed": True, "still_current": True},
                "SC-extra": {"name": "still-current contract", "changed": False, "still_current": True},
            },
            gates=[
                {
                    "id": "G-1",
                    "classification": "not-run-unavailable",
                    "affected_contract_ids": ["SC-1", "SC-extra"],
                    "fence": fence,
                }
            ],
            ui_mapping={f"UI-{kind}": kind for kind in runtime.UI_KINDS},
        )
        projection = authoritative_captured_projection(captured, cycle, run, fence)
        self.assertIsNotNone(projection)
        self.assertEqual({"RW-1", "RW-extra"}, set(projection["open_current_watches"]))
        self.assertEqual({"SC-1", "SC-extra"}, set(projection["affected_contracts"]))
        self.assertEqual(
            CORE_REQUIRED_ROLES
            | {"regression-falsifier", "source-contract-verifier", "ui-runtime-verifier", "repo-audit"},
            projection["required_roles"],
        )
        caller_omitted_extra_watch = [("RW-1", "passed", cycle, fence)]
        self.assertFalse(
            regression_verdicts_pass(
                captured, caller_omitted_extra_watch, cycle, run, fence
            )
        )
        for malformed in (
            {},
            {**captured, "immutable": False},
            {**captured, "fence": ("wrong", "scope", "hash")},
            {**captured, "regression_watches": "caller-selected"},
            {
                **captured,
                "regression_watches": [
                    {
                        "id": "RW-stale",
                        "status": "open",
                        "changed_cycle": cycle - 1,
                        "fence": OTHER_FENCE,
                    }
                ],
            },
        ):
            with self.subTest(malformed_capture=malformed):
                self.assertIsNone(
                    authoritative_captured_projection(malformed, cycle, run, fence)
                )
        reducers = self.concurrency.split("### Evidence reducers", 1)[1].split(
            "## Review-input revisions", 1
        )[0]
        for phrase in (
            "reconstruct the controller-captured immutable current-state projection from the pointer authority JSON",
            "complete claim/watch additions",
            "all open watches",
            "affected contracts",
            "caller-selected Booleans, claim lists, subsets, or empty mappings",
            "missing, stale, malformed, mutable, or non-reconstructible capture fails closed",
        ):
            self.assertIn(normalize(phrase), normalize(reducers))

    def test_atomic_coverage_obligations_fail_closed(self) -> None:
        fence = VALID_FENCE
        captured = make_captured_state(3, "run-3", fence)
        context = (3, "run-3", "dispatch-c", fence, captured)
        extra = [("probe", "claim:coverage-review")]
        allocated = preallocate_coverage_ids(1, len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + len(extra))
        expected = authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), allocated, "dispatch-c", [], extra)
        rows = [
            {"id": coverage_id, "kind": kind, "obligation": obligation, "disposition": "covered" if kind == "inventory" else "not-applicable", "evidence": f"metadata:{obligation}", "reason": "", "gap": "", "cycle": 3, "run": "run-3", "dispatch": "dispatch-c", "fence": fence}
            for coverage_id, (kind, obligation) in expected.items()
        ]
        self.assertEqual(
            len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + len(extra),
            len(expected),
        )
        self.assertEqual(
            len(RPF_SOURCE_SURFACES),
            sum(kind == "inventory" for kind, _ in expected.values()),
        )
        self.assertEqual(set(GAME_FAMILIES), {obligation for kind, obligation in expected.values() if kind == "game"})
        self.assertTrue(set(INCIDENT_FAMILIES).issubset({obligation for kind, obligation in expected.values() if kind == "probe"}))
        self.assertTrue(all(re.fullmatch(r"COV-\d+", coverage_id) for coverage_id in expected))
        with self.assertRaises(ValueError):
            authoritative_coverage_mapping([], allocated, "dispatch-c", [], extra)
        with self.assertRaises(ValueError):
            authoritative_coverage_mapping(tuple(RPF_SOURCE_SURFACES), allocated, "dispatch-c", [], extra)  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), ["COV-I-1", *allocated[1:]], "dispatch-c", [], extra)
        with self.assertRaises(ValueError):
            authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), allocated, "dispatch-new", [{"id": allocated[0], "dispatch": "dispatch-old"}], extra)
        self.assertTrue(coverage_obligations_complete(expected, rows, set(), *context))
        invalid = (
            rows[:-1],
            rows + [dict(rows[0])],
            [{**rows[0], "disposition": "applicable"}, *rows[1:]],
            [{**rows[0], "evidence": ""}, *rows[1:]],
            [{**rows[0], "kind": "probe"}, *rows[1:]],
            [{**rows[0], "obligation": "composite"}, *rows[1:]],
        )
        for candidate in invalid:
            with self.subTest(candidate=candidate):
                self.assertFalse(coverage_obligations_complete(expected, candidate, set(), *context))
        blocked_rows = [{**rows[0], "disposition": "uninspectable", "reason": "classifier unavailable", "gap": "GAP-7"}, *rows[1:]]
        self.assertTrue(coverage_obligations_complete(expected, blocked_rows, {"GAP-7"}, *context))
        for bad_gap, open_gaps in (("truthy", {"GAP-7"}), ("GAP-8", {"GAP-7"}), ("GAP-7", set())):
            self.assertFalse(coverage_obligations_complete(expected, [{**blocked_rows[0], "gap": bad_gap}, *blocked_rows[1:]], open_gaps, *context))
        self.assertFalse(coverage_obligations_complete({}, [], set(), *context))
        self.assertFalse(coverage_obligations_complete(expected, [None], set(), *context))  # type: ignore[list-item]
        self.assertFalse(coverage_obligations_complete(expected, [{}], set(), *context))
        self.assertFalse(
            coverage_obligations_complete(
                expected, [{**rows[0], "id": []}, *rows[1:]], set(), *context
            )
        )
        caller_sample = {next(iter(expected)): next(iter(expected.values()))}
        self.assertFalse(coverage_obligations_complete(expected, rows[:1], set(), *context))
        self.assertTrue(caller_sample)  # a nonempty sample still cannot replace `expected`

    def test_backup_restore_identity_and_roundtrip_components_are_atomic(self) -> None:
        fence = VALID_FENCE
        extra = [("probe", "claim:backup-contract")]
        allocated = preallocate_coverage_ids(
            100,
            len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + 1,
        )
        expected = authoritative_coverage_mapping(
            list(RPF_SOURCE_SURFACES), allocated, "dispatch-b", [], extra
        )
        rows = [
            {
                "id": coverage_id,
                "kind": kind,
                "obligation": obligation,
                "disposition": "covered" if kind == "inventory" or obligation.startswith("claim:") else "not-applicable",
                "evidence": f"evidence:{obligation}",
                "reason": "",
                "gap": "",
                "cycle": 5,
                "run": "run-5",
                "dispatch": "dispatch-b",
                "fence": fence,
            }
            for coverage_id, (kind, obligation) in expected.items()
        ]
        backup_index = next(
            index for index, row in enumerate(rows)
            if row["obligation"] == "backup-restore-equivalence"
        )
        structured = {
            "export_producer": "BackupExporter.export",
            "import_consumer": "RestoreImporter.import",
            "schema": "backup-schema-v3",
            "version": "3",
            "content": "payload-sha:approved-evidence",
            "ordering": "manifest-before-content",
            "export_record_id": "EXPORT-9",
            "import_record_id": "IMPORT-9",
            "comparison_id": "COMPARE-9",
        }
        record_common = {
            "immutable": True,
            "cycle": 5,
            "run": "run-5",
            "fence": fence,
            "schema": structured["schema"],
            "version": structured["version"],
            "content": structured["content"],
            "ordering": structured["ordering"],
        }
        backup_records = {
            "EXPORT-9": {**record_common, "id": "EXPORT-9", "kind": "export", "endpoint": structured["export_producer"]},
            "IMPORT-9": {**record_common, "id": "IMPORT-9", "kind": "import", "endpoint": structured["import_consumer"]},
        }
        backup_comparisons = {
            "COMPARE-9": {
                "id": "COMPARE-9",
                "immutable": True,
                "cycle": 5,
                "run": "run-5",
                "fence": fence,
                "export_record_id": "EXPORT-9",
                "import_record_id": "IMPORT-9",
                "result": "equal",
            }
        }
        captured = make_captured_state(
            5,
            "run-5",
            fence,
            backup_records=backup_records,
            backup_comparisons=backup_comparisons,
        )
        captured_projection = authoritative_captured_projection(
            captured, 5, "run-5", fence
        )
        context = (5, "run-5", "dispatch-b", fence, captured)
        rows[backup_index] = {
            **rows[backup_index],
            "disposition": "covered",
            "backup_restore": structured,
        }
        self.assertTrue(coverage_obligations_complete(expected, rows, set(), *context))
        self.assertFalse(
            backup_restore_evidence_valid(
                {"obligation": "backup-restore-equivalence", "disposition": "applicable"},
                captured_projection,
            )
        )
        for field in (
            "export_producer", "import_consumer", "schema", "version", "content", "ordering",
            "export_record_id", "import_record_id", "comparison_id",
        ):
            missing = dict(structured)
            missing.pop(field)
            candidate = list(rows)
            candidate[backup_index] = {**rows[backup_index], "backup_restore": missing}
            with self.subTest(missing_component=field):
                self.assertFalse(
                    coverage_obligations_complete(expected, candidate, set(), *context)
                )
        unresolved = {**structured, "export_record_id": "ARBITRARY-EXPORT"}
        candidate = list(rows)
        candidate[backup_index] = {**rows[backup_index], "backup_restore": unresolved}
        self.assertFalse(coverage_obligations_complete(expected, candidate, set(), *context))
        nested_id = {**structured, "export_record_id": []}
        candidate = list(rows)
        candidate[backup_index] = {**rows[backup_index], "backup_restore": nested_id}
        self.assertFalse(coverage_obligations_complete(expected, candidate, set(), *context))
        self.assertFalse(
            backup_restore_evidence_valid(candidate[backup_index], captured_projection)
        )
        same_record = {**structured, "import_record_id": "EXPORT-9"}
        candidate = list(rows)
        candidate[backup_index] = {**rows[backup_index], "backup_restore": same_record}
        self.assertFalse(coverage_obligations_complete(expected, candidate, set(), *context))
        self_authored_equality = {**structured, "result": "equal"}
        candidate = list(rows)
        candidate[backup_index] = {**rows[backup_index], "backup_restore": self_authored_equality}
        self.assertFalse(coverage_obligations_complete(expected, candidate, set(), *context))
        missing_record_capture = {**captured, "backup_records": {"IMPORT-9": backup_records["IMPORT-9"]}}
        self.assertFalse(
            coverage_obligations_complete(
                expected, rows, set(), 5, "run-5", "dispatch-b", fence,
                missing_record_capture,
            )
        )
        stale_record_capture = {
            **captured,
            "backup_records": {
                **backup_records,
                "EXPORT-9": {**backup_records["EXPORT-9"], "cycle": 4},
            },
        }
        self.assertFalse(
            coverage_obligations_complete(
                expected, rows, set(), 5, "run-5", "dispatch-b", fence,
                stale_record_capture,
            )
        )
        mismatched_record_capture = {
            **captured,
            "backup_records": {
                **backup_records,
                "IMPORT-9": {**backup_records["IMPORT-9"], "content": "different"},
            },
        }
        self.assertFalse(
            coverage_obligations_complete(
                expected, rows, set(), 5, "run-5", "dispatch-b", fence,
                mismatched_record_capture,
            )
        )
        stale_comparison_capture = {
            **captured,
            "backup_comparisons": {
                "COMPARE-9": {**backup_comparisons["COMPARE-9"], "cycle": 4}
            },
        }
        self.assertFalse(
            coverage_obligations_complete(
                expected, rows, set(), 5, "run-5", "dispatch-b", fence,
                stale_comparison_capture,
            )
        )
        self_authored_comparison_capture = {
            **captured,
            "backup_comparisons": {
                "COMPARE-9": {**backup_comparisons["COMPARE-9"], "result": "row-says-equal"}
            },
        }
        self.assertFalse(
            coverage_obligations_complete(
                expected, rows, set(), 5, "run-5", "dispatch-b", fence,
                self_authored_comparison_capture,
            )
        )
        for reference_field in ("export_record_id", "import_record_id"):
            for malformed_reference in ([], {}, set(), ""):
                malformed_comparison_capture = {
                    **captured,
                    "backup_comparisons": {
                        "COMPARE-9": {
                            **backup_comparisons["COMPARE-9"],
                            reference_field: malformed_reference,
                        }
                    },
                }
                with self.subTest(
                    reference_field=reference_field,
                    malformed_reference=malformed_reference,
                ):
                    self.assertIsNone(
                        authoritative_captured_projection(
                            malformed_comparison_capture, 5, "run-5", fence
                        )
                    )
        forged_record_projection = {
            **captured_projection,
            "backup_records": {
                "EXPORT-9": {
                    "id": "EXPORT-9", "kind": "export",
                    "endpoint": structured["export_producer"],
                    "schema": structured["schema"], "version": structured["version"],
                    "content": structured["content"], "ordering": structured["ordering"],
                },
                "IMPORT-9": backup_records["IMPORT-9"],
            },
        }
        forged_comparison_projection = {
            **captured_projection,
            "backup_comparisons": {
                "COMPARE-9": {
                    "id": "COMPARE-9", "export_record_id": "EXPORT-9",
                    "import_record_id": "IMPORT-9", "result": "equal",
                }
            },
        }
        self.assertFalse(
            backup_restore_evidence_valid(rows[backup_index], forged_record_projection)
        )
        self.assertFalse(
            backup_restore_evidence_valid(rows[backup_index], forged_comparison_projection)
        )
        without_backup_identity = dict(expected)
        backup_id = rows[backup_index]["id"]
        without_backup_identity[backup_id] = ("probe", "chat-final-save-truthfulness")
        self.assertFalse(
            coverage_obligations_complete(without_backup_identity, rows, set(), *context)
        )
        self.assertIn("backup-restore-equivalence", INCIDENT_FAMILIES)
        self.assertIn("chat-final-save-truthfulness", INCIDENT_FAMILIES)
        self.assertIn("mobile-clipping-accessibility", INCIDENT_FAMILIES)
        self.assertNotIn("mobile-share-accessibility", INCIDENT_FAMILIES)
        mobile_id = next(
            coverage_id for coverage_id, (_, obligation) in expected.items()
            if obligation == "mobile-clipping-accessibility"
        )
        old_alias_mapping = {
            **expected,
            mobile_id: ("probe", "mobile-share-accessibility"),
        }
        old_alias_rows = [
            {**item, "obligation": "mobile-share-accessibility"}
            if item["id"] == mobile_id
            else item
            for item in rows
        ]
        self.assertFalse(
            coverage_obligations_complete(
                old_alias_mapping, old_alias_rows, set(), *context
            )
        )
        probes = section(self.verification, "Incident-derived adversarial probes")
        for phrase in (
            "Backup and restore roundtrip",
            "export producer",
            "import consumer",
            "actual export-to-import comparison",
            "final save",
            "error truthfulness",
        ):
            self.assertIn(normalize(phrase), normalize(probes))

    def test_clean_evidence_reconfirmation_is_the_only_nonmaterial_evidence(self) -> None:
        fence = VALID_FENCE
        state = {
            "findings": [],
            "gaps": [],
            "tasks": [],
            "decisions": [],
            "residual_risks": [],
            "claim": "verification remains clean",
            "source": "source-fence:F-5",
            "evidence": "verification-record:VR-5",
        }
        before = {
            "identity": "verification:contract-A",
            "kind": "verification",
            "cycle": 4,
            "run": "run-4",
            "mandatory": True,
            "fence": fence,
            "outcome": "passed",
            "substantive_state": state,
        }
        after = {**before, "cycle": 5, "run": "run-5"}
        self.assertTrue(
            evidence_row_is_nonmaterial(before, after, 5, "run-5", fence)
        )
        changes = {
            "findings": ["new finding"],
            "gaps": ["GAP-11"],
            "tasks": ["RPF-11"],
            "decisions": ["DEC-11"],
            "residual_risks": ["risk-11"],
            "claim": "changed claim",
            "source": "source-fence:F-6",
            "evidence": "new substantive evidence",
        }
        for field, changed_value in changes.items():
            with self.subTest(substantive_field=field):
                changed = {
                    **after,
                    "substantive_state": {**state, field: changed_value},
                }
                self.assertFalse(
                    evidence_row_is_nonmaterial(before, changed, 5, "run-5", fence)
                )
        self.assertFalse(
            evidence_row_is_nonmaterial(
                before, {**after, "mandatory": False}, 5, "run-5", fence
            )
        )
        self.assertFalse(
            evidence_row_is_nonmaterial(
                before, after, 5, "run-5", OTHER_FENCE
            )
        )
        forged_false_flags = {
            **after,
            "substantive_state": {**state, "evidence": "changed evidence"},
            "finding": False,
            "gap": False,
            "task": False,
            "decision": False,
            "residual_risk": False,
            "changed_claim": False,
            "substantive_evidence": False,
        }
        self.assertFalse(
            evidence_row_is_nonmaterial(
                before, forged_false_flags, 5, "run-5", fence
            )
        )
        new_finding = {
            **after,
            "substantive_state": {**state, "findings": ["new finding"]},
        }
        material_pointer_changes = int(
            not evidence_row_is_nonmaterial(before, new_finding, 5, "run-5", fence)
        )
        self.assertGreater(material_pointer_changes, 0)
        convergence = section(self.skill, "Convergence and stop conditions")
        self.assertIn("`MATERIAL_POINTER_CHANGES = 0`", convergence)
        for phrase in (
            "exact authoritative before/after row content",
            "identical clean source fence",
            "not row-supplied substantive Booleans",
            "forged false flags",
            "new finding or change makes `MATERIAL_POINTER_CHANGES > 0`",
            "convergence remains impossible",
        ):
            self.assertIn(normalize(phrase), normalize(self.concurrency))

    def test_atomic_source_contract_rows_require_every_field(self) -> None:
        fence = VALID_FENCE
        extra = [("probe", "claim:source-contract")]
        allocated = preallocate_coverage_ids(200, len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + len(extra))
        coverage_expected = authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), allocated, "dispatch-s", [], extra)
        coverage = [{"id": coverage_id, "kind": kind, "obligation": obligation, "disposition": "covered" if kind == "inventory" or obligation.startswith("claim:") else "not-applicable", "evidence": f"src:{obligation}", "reason": "", "gap": "", "cycle": 3, "run": "run-3", "dispatch": "dispatch-s", "fence": fence} for coverage_id, (kind, obligation) in coverage_expected.items()]
        producer_ref = {"path": SOURCE_PATH, "line": 1, "symbol": "producer"}
        consumer_ref = {"path": SOURCE_PATH, "line": 5, "symbol": "consumer"}

        def claim(text: str, ref: dict[str, object]) -> dict[str, object]:
            return {"claim": text, "refs": [ref]}

        row = {
            "id": "SC-1",
            "status": "verified",
            "rev": 1,
            "cycle": 3,
            "run_id": "run-3",
            "dispatch_id": "dispatch-s",
            "fence": fence,
            "contract": "changed contract",
            "producer": producer_ref,
            "consumers": [consumer_ref],
            "inputs": [
                {"name": "request", "type": "none", "source_ref": consumer_ref}
            ],
            "outputs": [
                {"name": "result", "type": "integer", "source_ref": producer_ref}
            ],
            "invariants": [claim("producer remains callable", producer_ref)],
            "success": claim("consumer receives result", consumer_ref),
            "error": claim("no local error branch", producer_ref),
            "variants": claim("single local variant", producer_ref),
            "counterexample": claim("searched alternate consumer", consumer_ref),
            "evidence": [producer_ref, consumer_ref],
            "residual_risk": "runtime behavior not executed by prohibition",
            "coverage_ids": list(allocated),
            "provenance": {
                "producer_ref": producer_ref,
                "consumer_refs": [consumer_ref],
                "evidence_refs": [producer_ref, consumer_ref],
            },
        }
        captured = make_captured_state(
            3,
            "run-3",
            fence,
            contracts={"SC-1": {"name": "changed contract", "changed": True, "still_current": True}},
            gates=[{"id": "G-1", "classification": "not-run-prohibited", "affected_contract_ids": ["SC-1"], "fence": fence}],
        )
        args = (captured, [row], coverage, coverage_expected, 3, "run-3", "dispatch-s", fence)
        self.assertEqual("passed", source_contract_status(*args))
        self.assertEqual("failed", source_contract_status(captured, [{**row, "status": "falsified"}], coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))
        self.assertEqual("incomplete", source_contract_status(captured, [row], coverage + [dict(coverage[0])], coverage_expected, 3, "run-3", "dispatch-s", fence))
        for candidate in (
            [],
            [row, dict(row)],
            [{**row, "contract": ""}],
            [{**row, "error": ""}],
            [{**row, "producer": "src/a.py:1"}],
            [{**row, "consumers": "src/a.py:3"}],
            [{**row, "producer": {**producer_ref, "line": 99}}],
            [{**row, "coverage_ids": ["COV-missing"]}],
            [{**row, "coverage_ids": [[]]}],
            [{**row, "cycle": 2}],
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual("incomplete", source_contract_status(captured, candidate, coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))
        for bad_coverage in (
            [{**coverage[0], "obligation": "wrong"}],
            [{**coverage[0], "disposition": "applicable"}],
            [{**coverage[0], "evidence": ""}],
            [{**coverage[0], "cycle": 2}],
        ):
            self.assertEqual("incomplete", source_contract_status(captured, [row], bad_coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))
        self.assertEqual("incomplete", source_contract_status(captured, [{**row, "producer": "NoNe"}], coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))
        self.assertEqual("incomplete", source_contract_status(captured, ["malformed"], coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))  # type: ignore[list-item]
        malformed_capture = {**captured}
        malformed_capture.pop("contracts")
        self.assertEqual("incomplete", source_contract_status(malformed_capture, [], [], {}, 3, "run-3", "dispatch-s", fence))
        no_contract_capture = make_captured_state(3, "run-3", fence)
        self.assertEqual("not-applicable", source_contract_status(no_contract_capture, [], [], {}, 3, "run-3", "dispatch-s", fence))
        changed_no_gate_capture = make_captured_state(
            3,
            "run-3",
            fence,
            contracts={
                "SC-CHANGED": {
                    "name": "changed without a gate",
                    "changed": True,
                    "still_current": True,
                }
            },
        )
        changed_projection = authoritative_captured_projection(
            changed_no_gate_capture, 3, "run-3", fence
        )
        self.assertEqual(
            {"SC-CHANGED": "changed without a gate"},
            changed_projection["affected_contracts"],
        )
        self.assertIn(
            "source-contract-verifier", changed_projection["required_roles"]
        )
        self.assertEqual(
            "incomplete",
            source_contract_status(
                changed_no_gate_capture, [], [], {}, 3, "run-3", "dispatch-s", fence
            ),
        )
        changed_no_gate_row = {
            **row,
            "id": "SC-CHANGED",
            "contract": "changed without a gate",
        }
        self.assertEqual(
            "incomplete",
            source_contract_status(
                changed_no_gate_capture,
                [changed_no_gate_row],
                [],
                {},
                3,
                "run-3",
                "dispatch-s",
                fence,
            ),
        )
        changed_not_applicable_gate_capture = make_captured_state(
            3,
            "run-3",
            fence,
            contracts={
                "SC-CHANGED": {
                    "name": "changed with no applicable gate",
                    "changed": True,
                    "still_current": True,
                }
            },
            gates=[
                {
                    "id": "G-NONE",
                    "classification": "not-applicable",
                    "affected_contract_ids": [],
                    "fence": fence,
                }
            ],
        )
        no_gate_projection = authoritative_captured_projection(
            changed_not_applicable_gate_capture, 3, "run-3", fence
        )
        self.assertIn(
            "source-contract-verifier", no_gate_projection["required_roles"]
        )
        self.assertEqual(
            "incomplete",
            source_contract_status(
                changed_not_applicable_gate_capture,
                [],
                [],
                {},
                3,
                "run-3",
                "dispatch-s",
                fence,
            ),
        )
        captured_extra = make_captured_state(
            3,
            "run-3",
            fence,
            contracts={
                "SC-1": {"name": "changed contract", "changed": True, "still_current": True},
                "SC-2": {"name": "extra current contract", "changed": False, "still_current": True},
            },
            gates=[{"id": "G-1", "classification": "not-run-prohibited", "affected_contract_ids": ["SC-1", "SC-2"], "fence": fence}],
        )
        self.assertEqual("incomplete", source_contract_status(captured_extra, [row], coverage, coverage_expected, 3, "run-3", "dispatch-s", fence))

    def test_atomic_ui_rows_require_complete_runtime_evidence(self) -> None:
        fence = VALID_FENCE
        cycle, run, dispatch = 3, "run-3", "dispatch-u"
        kinds = runtime.UI_KINDS
        extra = [("probe", f"claim:ui-{kind}") for kind in runtime.UI_KINDS]
        allocated = preallocate_coverage_ids(400, len(RPF_SOURCE_SURFACES) + len(GAME_FAMILIES) + len(INCIDENT_FAMILIES) + len(extra))
        coverage_expected = authoritative_coverage_mapping(list(RPF_SOURCE_SURFACES), allocated, dispatch, [], extra)
        ui_coverage_ids = {obligation.removeprefix("claim:ui-"): coverage_id for coverage_id, (_, obligation) in coverage_expected.items() if obligation.startswith("claim:ui-")}
        runtime_records = {
            f"EXEC-{kind}": {
                "id": f"EXEC-{kind}",
                "immutable": True,
                "cycle": cycle,
                "run": run,
                "fence": fence,
                "runner": "browser",
                "snapshot_id": "immutable-ui-snapshot",
                "command": "repo-ui-check",
                "action": f"exercise:{kind}",
                "expected": "usable",
                "observed": "usable",
                "result": "passed",
            }
            for kind in kinds
        }
        captured = make_captured_state(
            cycle,
            run,
            fence,
            ui_mapping={f"UI-{kind}": kind for kind in kinds},
            runtime_records=runtime_records,
        )
        rows = [
            {"id": f"UI-{kind}", "status": "verified", "kind": kind, "disposition": "covered", "evidence_kind": "runtime", "evidence": f"runtime:{kind}", "runtime_record_id": f"EXEC-{kind}", "blocker": "", "coverage_id": ui_coverage_ids[kind], "cycle": cycle, "run": run, "dispatch": dispatch, "fence": fence}
            for kind in kinds
        ]
        coverage = [{"id": coverage_id, "kind": kind, "obligation": obligation, "disposition": "covered" if kind == "inventory" or obligation.startswith("claim:") else "not-applicable", "evidence": f"runtime:{obligation}", "reason": "", "gap": "", "cycle": cycle, "run": run, "dispatch": dispatch, "fence": fence} for coverage_id, (kind, obligation) in coverage_expected.items()]
        args = (captured, rows, coverage, coverage_expected, cycle, run, dispatch, fence)
        self.assertEqual("verified", reduce_ui_status(*args))
        for candidate in (
            rows[:-1],
            rows + [dict(rows[0])],
            [{**rows[0], "evidence_kind": "static"}, *rows[1:]],
            [{**rows[0], "kind": "screen"}, *rows[1:]],
            [{**rows[0], "evidence": ""}, *rows[1:]],
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual("unverified-unavailable", reduce_ui_status(captured, candidate, coverage, coverage_expected, cycle, run, dispatch, fence))
        placeholders = [
            {
                **row,
                "runtime_record_id": f"PLACEHOLDER-{row['kind']}",
                "runtime_provenance": {"runner": "browser", "snapshot_id": "immutable-ui-snapshot", "command": "repo-ui-check"},
                "runtime_observation": {"action": f"exercise:{row['kind']}", "expected": "usable", "observed": "usable"},
            }
            for row in rows
        ]
        self.assertEqual("unverified-unavailable", reduce_ui_status(captured, placeholders, coverage, coverage_expected, cycle, run, dispatch, fence))

        linked_index = next(index for index, item in enumerate(coverage) if item["id"] == rows[0]["coverage_id"])
        prohibited_coverage = list(coverage)
        prohibited_coverage[linked_index] = {**prohibited_coverage[linked_index], "disposition": "excluded", "reason": "runtime prohibited", "gap": "GAP-9"}
        prohibited_rows = [{**rows[0], "status": "unverified-prohibited", "disposition": "excluded", "evidence_kind": "none", "runtime_record_id": "", "blocker": "authority:repo-policy"}, *rows[1:]]
        prohibited_capture = {**captured, "open_gap_ids": {"GAP-9"}}
        self.assertEqual("unverified-prohibited", reduce_ui_status(prohibited_capture, prohibited_rows, prohibited_coverage, coverage_expected, cycle, run, dispatch, fence))

        unavailable_coverage = list(coverage)
        unavailable_coverage[linked_index] = {**unavailable_coverage[linked_index], "disposition": "uninspectable", "reason": "browser unavailable", "gap": "GAP-10"}
        unavailable_rows = [{**rows[0], "status": "unverified-unavailable", "disposition": "uninspectable", "evidence_kind": "none", "runtime_record_id": "", "blocker": "environment:no-browser"}, *rows[1:]]
        unavailable_capture = {**captured, "open_gap_ids": {"GAP-10"}}
        self.assertEqual("unverified-unavailable", reduce_ui_status(unavailable_capture, unavailable_rows, unavailable_coverage, coverage_expected, cycle, run, dispatch, fence))

        failed_record = {**runtime_records["EXEC-route"], "observed": "broken", "result": "failed"}
        failed_capture = {**captured, "runtime_records": {**runtime_records, "EXEC-route": failed_record}}
        failed_rows = [{**rows[0], "status": "failed"}, *rows[1:]]
        self.assertEqual("failed", reduce_ui_status(failed_capture, failed_rows, coverage, coverage_expected, cycle, run, dispatch, fence))

        na_rows = [{**row, "status": "not-applicable", "disposition": "not-applicable", "evidence_kind": "none", "runtime_record_id": ""} for row in rows]
        na_coverage = [
            {**item, "disposition": "not-applicable"}
            if item["id"] in {row["coverage_id"] for row in rows}
            else item
            for item in coverage
        ]
        self.assertEqual("unverified-unavailable", reduce_ui_status(captured, na_rows, na_coverage, coverage_expected, cycle, run, dispatch, fence))

        no_ui_capture = make_captured_state(cycle, run, fence, no_ui_dispatch=dispatch)
        self.assertEqual("not-applicable", reduce_ui_status(no_ui_capture, [no_ui_capture["no_ui_detection"]], [], {}, cycle, run, dispatch, fence))
        composite_no_ui = [{**no_ui_capture["no_ui_detection"], "kind": "route+viewport+interaction+variant+mobile-layout+accessibility"}]
        self.assertEqual("unverified-unavailable", reduce_ui_status(no_ui_capture, composite_no_ui, [], {}, cycle, run, dispatch, fence))

    def test_convergence_evidence_conflicts_block_before_tie_break(self) -> None:
        merge = section(self.concurrency, "Merge rules")
        for phrase in (
            "collapse byte-identical rows first",
            "same-ID, equal-`Rev`, non-identical row blocks the candidate merge",
            "coverage gap before status or row-hash tie-breaking",
            "conflicting restricted links remain visible",
        ):
            self.assertIn(normalize(phrase), normalize(merge))
        for kind in ("restricted", "gate", "source-contract", "UI"):
            with self.subTest(kind=kind):
                identical = [(f"{kind}-1", 7, "payload"), (f"{kind}-1", 7, "payload")]
                conflict = [(f"{kind}-1", 7, "payload-a"), (f"{kind}-1", 7, "payload-b")]
                self.assertTrue(convergence_rows_unambiguous(identical))
                self.assertFalse(convergence_rows_unambiguous(conflict))
        self.assertFalse(convergence_rows_unambiguous([("RR-1", 7, "links=RPF-1"), ("RR-1", 7, "links=GAP-1")]))
        self.assertTrue(convergence_rows_unambiguous([("RR-1", 7, "links=RPF-1"), ("RR-1", 8, "links=GAP-1")]))

    def test_quarantine_count_requires_exact_unresolved_links(self) -> None:
        pointer_rows = section(self.pointer, "Restricted results")
        restricted = section(self.verification, "Restricted or safety-filtered results")
        reducers = self.concurrency.split("### Evidence reducers", 1)[1].split(
            "## Review-input revisions", 1
        )[0]

        def contract(pointer_text: str, restricted_text: str, reducer_text: str) -> bool:
            pointer_text = normalize(pointer_text)
            restricted_text = normalize(restricted_text)
            reducer_text = normalize(reducer_text)
            return all(
                (
                    "Every `restricted` row requires at least one link" in pointer_text,
                    "`-`, an empty cell, and free-form text are invalid" in pointer_text,
                    "distinct unresolved exact work or gap IDs" in restricted_text,
                    "cardinality of the set union" in reducer_text,
                    "exact, nonterminal `RPF-<digits>` and `GAP-<digits>` links" in reducer_text,
                    "malformed token" in reducer_text,
                    "blocks convergence" in reducer_text,
                    "do not coerce invalid links into a zero count" in reducer_text,
                )
            )

        self.assertTrue(contract(pointer_rows, restricted, reducers))
        flat_pointer = normalize(pointer_rows)
        flat_restricted = normalize(restricted)
        flat_reducers = normalize(reducers)
        counterexamples = (
            (flat_pointer.replace("requires at least one link", "may omit links"), flat_restricted, flat_reducers),
            (flat_pointer.replace("`-`, an empty cell, and free-form text are invalid", "`-` is valid"), flat_restricted, flat_reducers),
            (flat_pointer, flat_restricted.replace("distinct unresolved exact work or gap IDs", "restricted row count"), flat_reducers),
            (flat_pointer, flat_restricted, flat_reducers.replace("cardinality of the set union", "number of rows")),
            (flat_pointer, flat_restricted, flat_reducers.replace("blocks convergence", "is ignored")),
            (flat_pointer, flat_restricted, flat_reducers.replace("do not coerce invalid links into a zero count", "coerce invalid links into zero")),
        )
        for bad_pointer, bad_restricted, bad_reducers in counterexamples:
            with self.subTest(counterexample=normalize(bad_pointer[-80:] + bad_reducers[-80:])):
                self.assertFalse(contract(bad_pointer, bad_restricted, bad_reducers))

        live = {"RPF-1", "GAP-1", "GAP-2"}
        self.assertEqual(
            2,
            quarantined_item_count(
                [("restricted", ["RPF-1", "GAP-1"]), ("restricted", ["GAP-1"])],
                live,
            ),
        )
        self.assertEqual(0, quarantined_item_count([("resolved", [])], live))
        for invalid in (
            [("restricted", [])],
            [("restricted", ["-"])],
            [("restricted", ["free form"])],
            [("restricted", ["RPF-999"])],
        ):
            with self.subTest(invalid_restricted_rows=invalid):
                self.assertIsNone(quarantined_item_count(invalid, live))

    def test_coverage_includes_game_and_incident_risk_surfaces(self) -> None:
        coverage = section(self.verification, "Reproducible inventory and coverage")
        probes = section(self.verification, "Incident-derived adversarial probes")
        for term in (
            "lifecycle",
            "scenes",
            "assets",
            "physics/AI",
            "economy/progression",
            "save/load",
            "network",
            "platform variants",
            "excluded",
            "uninspectable",
        ):
            with self.subTest(term=term):
                self.assertIn(term, coverage)
        for term in (
            "failed read cannot overwrite the only recoverable copy",
            "email-only",
            "Session and teardown concurrency",
            "final save",
            "backup and restore",
            "Mobile sharing and accessibility",
        ):
            with self.subTest(term=term):
                self.assertIn(normalize(term), normalize(probes))
        self.assertIn("## Review coverage", self.pointer)

    def test_prohibited_tests_use_source_contracts_without_runtime_claims(self) -> None:
        contracts = section(
            self.verification, "Test prohibitions and static source contracts"
        )

        def contract_is_safe(text: str) -> bool:
            flat = normalize(text).lower()
            return all(
                phrase in flat
                for phrase in (
                    "never `passed`, `green`, or evidence of runtime behavior",
                    "without claiming runtime equivalence",
                    "never means tests passed or runtime behavior was reproduced",
                    "runtime-equivalent because static evidence passed is a contract contradiction",
                )
            ) and "static evidence establishes runtime equivalence" not in flat

        self.assertTrue(contract_is_safe(contracts))
        self.assertFalse(contract_is_safe(contracts + " Static evidence establishes runtime equivalence."))
        for phrase in (
            "not-run-prohibited",
            "not-run-unavailable",
            "Producer",
            "Consumers",
            "Inputs / preconditions",
            "Error path",
            "Counterexample search",
            "It never means tests passed or runtime behavior was reproduced",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(normalize(phrase), normalize(contracts))
        self.assertIn("## Test prohibitions", self.pointer)
        self.assertIn("## Source contract verification", self.pointer)

    def test_ui_runtime_state_is_independent(self) -> None:
        ui = section(self.verification, "UI runtime status")

        def ui_contract_is_safe(text: str) -> bool:
            flat = normalize(text).lower()
            return all(
                phrase in flat
                for phrase in (
                    "cannot set `verified`",
                    "linked coverage row must itself be `covered`",
                    "never collapse this to a verified-only boolean",
                    "`runtime record id` trust link",
                    "controller capture",
                    "well-shaped row-authored provenance/observation placeholder fails",
                    "static evidence, a screenshot, or a truthy placeholder sets ui status to `verified` is a contract contradiction",
                )
            ) and "static evidence may set `verified`" not in flat

        self.assertTrue(ui_contract_is_safe(ui))
        self.assertFalse(ui_contract_is_safe(ui + " Static evidence may set `verified`."))
        for status in (
            "`not-applicable`",
            "`verified`",
            "`unverified-prohibited`",
            "`unverified-unavailable`",
            "`failed`",
        ):
            with self.subTest(status=status):
                self.assertIn(status, ui)
        self.assertIn("cannot set `verified`", ui)
        self.assertIn("## UI runtime verification", self.pointer)
        self.assertIn("UI_RUNTIME_STATUS", self.skill)

    def test_pointer_bootstrap_and_canonical_evidence_headers(self) -> None:
        self.assertIn("- Prohibited checks: none", self.pointer)
        self.assertIn("- Unavailable checks: none", self.pointer)
        self.assertIn(
            "| Fence ID | Cycle | Run | Eligibility | Base HEAD SHA | Scope | Scope hash | Evidence |",
            self.pointer,
        )
        self.assertIn(
            "| Cycle | Run | Role ID | Dispatch ID | Role instance | Required | Source fence | Status | Coverage IDs | Result ID | Evidence |",
            self.pointer,
        )
        self.assertIn(
            "| Result ID | Cycle | Run | Role ID | Dispatch ID | Source fence | Required status | Closed status | Counterexample search | Source-grounded evidence | Coverage IDs | Specialized detail IDs |",
            self.pointer,
        )

    def test_restricted_results_quarantine_only_the_affected_unit(self) -> None:
        restricted = section(
            self.verification, "Restricted or safety-filtered results"
        )
        for phrase in (
            "Do not replay the response or retry the same prompt",
            "stop only that unit",
            "Continue aggregation and Phase 2 for every safe terminal result",
            "is not malformed and is not an unrecoverable whole-cycle",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, restricted)
        self.assertIn("## Restricted results", self.pointer)
        for field in ("RESTRICTED_RESULTS", "QUARANTINED_ITEMS"):
            self.assertIn(field, self.skill)

    def test_secret_safe_io_prevents_value_ingestion_and_replay(self) -> None:
        secret_io = section(self.verification, "Secret-safe inputs and outputs")
        for phrase in (
            "Do not read or print raw `.env*`",
            "environment dumps",
            "shell tracing",
            "Never place secret bytes in `ROOT_PAYLOAD`",
            "do not quote, summarize, repeat, hash, or send the value",
            "Never rotate or revoke credentials without explicit authorization",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(normalize(phrase), normalize(secret_io))
        self.assertIn("## Secret exposure incidents", self.pointer)
        self.assertIn("secret-safe command preflight", self.detection)
        self.assertIn("blocked bytes never enter a bundle or merge", self.concurrency)
        self.assertIn("SECRET_EXPOSURE", self.skill)

    def test_cycle_report_and_pointer_expose_separate_evidence_fields(self) -> None:
        for field in (
            "SOURCE_FENCE",
            "MATERIAL_SOURCE_CHANGES",
            "INDEPENDENT_REVIEW",
            "RESULT_FALSIFICATION",
            "REGRESSION_FALSIFICATION",
            "SOURCE_CONTRACT_STATUS",
            "COVERAGE_GAPS",
            "PROHIBITED_CHECKS",
            "UNAVAILABLE_CHECKS",
            "UI_RUNTIME_STATUS",
            "RESTRICTED_RESULTS",
            "QUARANTINED_ITEMS",
            "SECRET_EXPOSURE",
        ):
            with self.subTest(field=field):
                self.assertIn(field, self.skill)
        self.assertIn("green allowed gates", self.verification)
        self.assertIn("do not imply verified UI runtime", self.verification)

    def test_no_gate_state_and_derived_summary_merge_are_coherent(self) -> None:
        self.assertIn("GATES_GREEN: <yes | no | not-applicable>", self.skill)
        self.assertIn("no allowed configured gate", self.skill)
        self.assertIn("no allowed gate ran", self.verification)
        self.assertIn("still creates a coverage gap", self.verification)
        self.assertIn("## Gate results", self.pointer)
        self.assertIn("Gate results", self.detection)
        self.assertIn("gate results", self.concurrency)
        self.assertIn("`GATES_GREEN`", self.concurrency)
        for summary in (
            "review",
            "falsification",
            "source-contract",
            "coverage-gap",
            "UI-runtime",
            "restricted/quarantined",
            "secret-exposure",
        ):
            with self.subTest(summary=summary):
                self.assertIn(summary, self.concurrency)
        self.assertIn("never from a stale scalar", self.concurrency)

        counter_merge = self.concurrency.split("- **Counters**", 1)[1].split(
            "- **Active runs**", 1
        )[0]
        self.assertNotIn("Last clean independent-review cycle", counter_merge)
        self.assertNotIn("Last regression-falsification cycle", counter_merge)
        self.assertIn("last-clean and last-regression cycle/fence pairs", counter_merge)
        self.assertIn("pair atomically", self.concurrency)
        for count in ("`GOAL_GAPS`", "`PENDING_TASKS`", "`ACTIVE_PEERS`"):
            with self.subTest(count=count):
                self.assertIn(count, self.concurrency)

    def test_technical_failures_are_nonterminal_and_sink_local(self) -> None:
        for phrase in (
            "never becomes RPF `blocked`",
            "does not advance the repeated-blocker count",
            "Keep the RPF objective active",
            "Defer only the affected sink",
            "same technical symptom appeared in three goal turns",
            "reconcile-interrupted-attempt",
            "export_state(authentication_key=...)",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, normalize(self.technical))
        convergence = section(self.skill, "Convergence and stop conditions")
        self.assertIn("Do not stop or mark the RPF/host goal `blocked`", convergence)
        self.assertIn("TechnicalRecoveryLedger", convergence)
        self.assertNotIn("blocked-provider-unavailable", self.concurrency)
        self.assertIn("deferred-provider-unavailable", self.concurrency)


if __name__ == "__main__":
    unittest.main()
