# Local Cognee memory service

The assistant requires an unauthenticated Cognee API at **127.0.0.1:8765** for company-memory storage and recall. Keep it bound to loopback. This recipe uses a separate environment and data directory so it does not reuse another project's memory.

The recorded service uses **Cognee 1.5.4 on Python 3.12.12**. The package supports Python `>=3.10,<3.15`; its base install includes the API dependencies. The app's Neo4j/speech environment is separate.

## Install and run

Run from the repository root. Initial installation and tokenizer setup can download packages or data; this is not an offline-install claim. This recipe disables inference connectivity probes and points model endpoints at a closed local port. It supplies no paid model credentials.

```sh
uv venv run/cognee-venv --python 3.12.12
uv pip install --python run/cognee-venv/bin/python 'cognee==1.5.4'
mkdir -p run/cognee/system run/cognee/data run/cognee/cache
SYNTH_COGNEE_PYTHON="$PWD/run/cognee-venv/bin/python"
SYNTH_COGNEE_ROOT="$PWD/run/cognee"
cd "$SYNTH_COGNEE_ROOT"
env -i PATH="$PATH" HOME="$HOME" \
  PYTHON_DOTENV_DISABLED=1 \
  TELEMETRY_DISABLED=1 COGNEE_TRACING_ENABLED=false \
  ENABLE_BACKEND_ACCESS_CONTROL=false REQUIRE_AUTHENTICATION=false \
  CACHING=false COGNEE_SKIP_CONNECTION_TEST=true \
  LITELLM_LOCAL_MODEL_COST_MAP=true \
  LLM_PROVIDER=openai EMBEDDING_PROVIDER=openai \
  LLM_API_KEY=unused EMBEDDING_API_KEY=unused \
  LLM_ENDPOINT=http://127.0.0.1:9/v1 \
  EMBEDDING_ENDPOINT=http://127.0.0.1:9/v1 \
  SYSTEM_ROOT_DIRECTORY="$PWD/system" \
  DATA_ROOT_DIRECTORY="$PWD/data" XDG_CACHE_HOME="$PWD/cache" \
  "$SYNTH_COGNEE_PYTHON" -c \
  "from cognee.api.client import start_api_server; start_api_server(host='127.0.0.1', port=8765)"
```

Keep that terminal running. In another terminal, a harmless readiness check is:

```sh
curl --fail http://127.0.0.1:8765/api/v1/datasets
```

An empty JSON array is valid before the first memory save. The app creates its `hackathon-orderdesk-20260911` dataset itself.

The clean working directory matters: Cognee and Pydantic can discover `.env` files. Do not place a credential-bearing `.env` in the isolated service directory. `COGNEE_SKIP_CONNECTION_TEST=true` is required because even raw ingestion otherwise performs first-run model connectivity tests. This flow uses raw text ingestion and retrieval; it never calls Cognify.

## What was checked

An isolated loopback service using the installed pinned package returned a dataset list, accepted a synthetic text-memory document with HTTP 200 and `PipelineRunCompleted`, and returned byte-equivalent JSON through the raw-data endpoint. Model endpoints were directed to local port 9, no real model credentials were provided, and the temporary process was stopped afterwards. [Smoke receipt](../evidence/final-flow-cognee-setup.json).

This validates startup and raw-memory API behavior against the installed package; it is not a clean-machine installation test. Cognee 1.5.4 and some of its companion dependencies carry disclosed advisories. Keep this prototype service local and read [the security notes](SECURITY.md) before adopting it.
