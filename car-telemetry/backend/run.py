"""Convenience launcher: `python run.py`  (equivalent to uvicorn app.server:app)."""
from __future__ import annotations

import uvicorn

from app.config import config

if __name__ == "__main__":
    uvicorn.run(
        "app.server:app",
        host=config.host,
        port=config.port,
        reload=False,
        log_level="info",
    )
