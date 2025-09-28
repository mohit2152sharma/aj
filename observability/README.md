## FastAPI server

### Run locally

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Endpoints

- POST `/greet` body: `{ "username": "alice" }` → `{ "message": "hello alice" }`
- GET `/greet/{username}` → `{ "message": "hello username" }`

### Docker

```bash
docker build -t observability:local .
docker run -p 8000:8000 observability:local
```

### Health check

```bash
curl -s localhost:8000/greet/world | jq .
# { "message": "hello world" }
```

