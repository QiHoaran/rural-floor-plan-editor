#!/usr/bin/env python
from pathlib import Path

from rural_data_prep.multimodal_cli import main


raise SystemExit(main("image", Path(__file__)))
