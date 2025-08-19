import os
from typing import overload

from utilities.config import RunConfig
from utilities.logger import logger


@overload
def get_env_var(
    key: str,
    default: str,
    raise_error: bool = False,
    error_msg: str = "Something",
) -> str: ...


@overload
def get_env_var(
    key: str,
    default: None = None,
    raise_error: bool = False,
    error_msg: str = "Something",
) -> str | None: ...


def get_env_var(
    key: str,
    default: str | None = None,
    raise_error: bool = False,
    error_msg: str = "Something",
) -> str | None:
    _value = os.getenv(key, default)
    if _value is None:
        if raise_error:
            raise ValueError("Env not present")
        else:
            logger.warn("Env not present")

    return _value


def get_log_level() -> str:
    return get_env_var("LOG_LEVEL", "INFO", raise_error=True)


def get_run_env() -> str | None:
    return get_env_var("RUN_ENV", None, False)


RunConfig("local", "1.0.0")
print(get_run_env())
print(get_log_level())
