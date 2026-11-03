# hi
# Lets the tests run from the repo root as well as from backend/.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GRIDNOVA_OFFLINE", "1")  # no network calls in tests
os.environ.setdefault("GRIDNOVA_NO_LOOP", "1")  # no background agent loop in tests
os.environ.setdefault("GRIDNOVA_AUTH", "off")  # most tests call the API without signing in
