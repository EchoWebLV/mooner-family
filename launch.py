#!/usr/bin/env python3
"""Shim so `python3 launch.py ...` works from the repo root. The real script is launch-test/launch.py."""
import os
import runpy
import sys

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch-test")
sys.argv[0] = os.path.join(here, "launch.py")
runpy.run_path(sys.argv[0], run_name="__main__")
