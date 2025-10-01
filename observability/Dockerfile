FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install OS packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        vim \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml uv.lock README.md ./
COPY app ./app

# Install dependencies
RUN uv sync --frozen --no-dev

# Expose port
EXPOSE 8000
ENV PATH="/app/.venv/bin:$PATH"

# Run the FastAPI app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]


