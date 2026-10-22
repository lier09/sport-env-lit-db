"""Subprocess entry: save machine-readable outcome without secret tracebacks."""
import os
from pathlib import Path
import runpy
import sys
import time

from openalex_runtime import Deferred, PipelineError, atomic_json, redact
from data_transaction import Transaction


def main():
    script, *args = sys.argv[1:]
    sys.argv = [script, *args]
    sys.path.insert(0, str(Path(script).resolve().parent))
    outcome = Path(os.environ["OA_STATE_DIR"]) / "outcomes" / (os.environ["OA_RUN_ID"] + ".json")
    transaction = Transaction(Path(os.environ['OA_STATE_DIR']), Path(script).resolve().parent.parent, os.environ['OA_JOB'])
    try:
        transaction.begin()
        try:
            runpy.run_path(script, run_name="__main__")
        except SystemExit as exc:
            if exc.code not in (0, None):
                raise PipelineError(f"Script returned {exc.code}") from None
        transaction.commit()
        atomic_json(outcome, {"status": "complete", "at": time.time()})
        return 0
    except Deferred as exc:
        transaction.rollback()
        atomic_json(outcome, {"status": "pending", "reason": exc.reason, "retry_at": exc.retry_at})
        print(str(exc), flush=True)
        return 75
    except PipelineError as exc:
        transaction.rollback()
        atomic_json(outcome, {"status": "blocked", "reason": redact(exc)})
        print(redact(exc), flush=True)
        return 78
    except Exception as exc:
        transaction.rollback()
        # No traceback containing signed URLs. Local log retains exception type
        # and a redacted message; source file/line can be diagnosed separately.
        message = type(exc).__name__ + ": " + redact(exc)
        atomic_json(outcome, {"status": "blocked", "reason": message})
        print(message, flush=True)
        return 78


if __name__ == "__main__":
    sys.exit(main())
