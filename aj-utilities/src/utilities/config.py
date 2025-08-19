import uuid


class RunConfig:
    _instance = None
    _initialized = False  # prevent re-initializing on repeated calls

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, environment: str, version: str, library: str = "main", **kwargs):
        if not self._initialized:  # ensure init runs only once
            self.run_id = str(uuid.uuid4())
            self.environment = environment
            self.version = version
            self.library = library

            self._configs = {
                "run_id": self.run_id,
                "environment": self.environment,
                "version": self.version,
                "library": self.library,
                **kwargs,
            }
            self._initialized = True

    @classmethod
    def get(cls):
        if cls._instance is None:
            raise RuntimeError("RunConfig not initialized. Call RunConfig first.")
        return cls._instance

    @classmethod
    def as_dict(cls):
        return cls._instance._configs
