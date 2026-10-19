#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "    mera.health Diabetic Patient Follow-Up Portal         "
echo "=========================================================="

# 1. Setup Python Virtual Environment & Dependencies
if [ ! -d ".venv" ]; then
    echo "[*] Setting up Python virtual environment..."
    if command -v uv &> /dev/null; then
        uv venv .venv
        uv pip install --python .venv/bin/python pandas
    else
        python3 -m venv .venv
        .venv/bin/pip install pandas
    fi
fi

# 2. Run Data Processing Pipeline
echo "[*] Running Clinical Data Processing Engine..."
.venv/bin/python scripts/process_data.py

# 3. Check Frontend Dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "[*] Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# 4. Launch React Application
echo "=========================================================="
echo "    Starting Web Dashboard on http://localhost:3000       "
echo "=========================================================="
cd frontend
npm run dev -- --port 3000
