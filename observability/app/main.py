from fastapi import FastAPI

from app.api.routers.greet import router as greet_router

app = FastAPI(title="observability")

app.include_router(greet_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

