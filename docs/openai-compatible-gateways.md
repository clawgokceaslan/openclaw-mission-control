# OpenAI-compatible gateways

Open Mission Control can use a self-hosted inference server that exposes the OpenAI `/v1` API shape. Create a gateway with provider `OpenAI-compatible`, then set:

- Base URL: include or omit `/v1`; OMC normalizes it before calling `/v1/models`.
- API key: optional for local servers; when present it is sent as a bearer token and masked in the UI.
- Default model: used when `/v1/models` is disabled, unavailable, or returns no usable model ids.

Supported examples:

- vLLM: `http://localhost:8000/v1`
- LocalAI: `http://localhost:8080/v1`
- OpenLLM-compatible deployments: use the deployment's OpenAI-compatible `/v1` URL.
- Ollama: `http://localhost:11434/v1`

Manual verification:

```sh
curl http://localhost:8000/v1/models
curl -H "Authorization: Bearer $API_KEY" http://localhost:8000/v1/models
```

After the gateway is saved, use **Refresh models**. If discovery fails but a default model is configured, project model settings can still use that model. Plan, run, and chat flows launch Codex with `OPENAI_BASE_URL` and `OPENAI_API_KEY` scoped to the selected gateway.
