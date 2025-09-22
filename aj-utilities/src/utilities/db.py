from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

import asyncpg
from pydantic import BaseModel

try:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    HAS_SQLALCHEMY = True
except ImportError:
    HAS_SQLALCHEMY = False


# Removed ensure_connected decorator - connections now made during instance creation


class DbConnectionConfig(BaseModel):
    db_host: str
    db_name: str
    db_username: str
    db_password: str
    db_port: int = 5432
    min_connections: int = 1
    max_connections: int = 10

    @property
    def connection_url(self) -> str:
        return f"postgresql://{self.db_username}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @property
    def async_connection_url(self) -> str:
        return f"postgresql+asyncpg://{self.db_username}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"


class BaseDatabase(ABC):
    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Check if database is connected"""

    @abstractmethod
    async def connect(self) -> None:
        """Establish database connection"""

    @abstractmethod
    async def close(self) -> None:
        """Close database connection"""

    @abstractmethod
    async def _fetch(self, query: str, *args: Any) -> List[Dict[str, Any]]:
        """Internal method to execute SELECT query and return all rows"""

    @abstractmethod
    async def _fetchrow(self, query: str, *args: Any) -> Optional[Dict[str, Any]]:
        """Internal method to execute SELECT query and return first row"""

    @abstractmethod
    async def _execute(self, query: str, *args: Any) -> str:
        """Internal method to execute query (INSERT/UPDATE/DELETE) and return status"""

    @abstractmethod
    async def _executemany(self, query: str, args: List[tuple]) -> None:
        """Internal method to execute query multiple times with different parameters"""

    @abstractmethod
    def _transaction(self):
        """Internal method for transaction context manager"""

    async def fetch(self, query: str, *args: Any) -> List[Dict[str, Any]]:
        """Execute a SELECT query and return all rows"""
        return await self._fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> Optional[Dict[str, Any]]:
        """Execute a SELECT query and return first row"""
        return await self._fetchrow(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        """Execute a query (INSERT/UPDATE/DELETE) and return status"""
        return await self._execute(query, *args)

    async def executemany(self, query: str, args: List[tuple]) -> None:
        """Execute a query multiple times with different parameters"""
        return await self._executemany(query, args)

    def transaction(self):
        """Context manager for database transactions"""
        return self._transaction()


class AsyncpgDatabase(BaseDatabase):
    def __init__(self, config: DbConnectionConfig):
        self.config = config
        self.pool: Optional[asyncpg.Pool] = None

    @classmethod
    async def create(cls, config: DbConnectionConfig) -> "AsyncpgDatabase":
        """Create and connect AsyncpgDatabase instance"""
        instance = cls(config)
        await instance.connect()
        return instance

    @property
    def is_connected(self) -> bool:
        """Check if connection pool exists"""
        return self.pool is not None

    async def connect(self) -> None:
        """Create connection pool"""
        if self.pool is None:
            self.pool = await asyncpg.create_pool(
                host=self.config.db_host,
                port=self.config.db_port,
                user=self.config.db_username,
                password=self.config.db_password,
                database=self.config.db_name,
                min_size=self.config.min_connections,
                max_size=self.config.max_connections,
            )

    async def close(self) -> None:
        """Close connection pool"""
        if self.pool:
            await self.pool.close()
            self.pool = None

    async def _fetch(self, query: str, *args: Any) -> List[Dict[str, Any]]:
        """Internal method to execute SELECT query and return all rows"""
        if self.pool is None:
            raise RuntimeError("Database not connected.")
        async with self.pool.acquire() as connection:
            rows = await connection.fetch(query, *args)
            return [dict(row) for row in rows]

    async def _fetchrow(self, query: str, *args: Any) -> Optional[Dict[str, Any]]:
        """Internal method to execute SELECT query and return first row"""
        if self.pool is None:
            raise RuntimeError("Database not connected.")
        async with self.pool.acquire() as connection:
            row = await connection.fetchrow(query, *args)
            return dict(row) if row else None

    async def _execute(self, query: str, *args: Any) -> str:
        """Internal method to execute query and return status"""
        if self.pool is None:
            raise RuntimeError("Database not connected.")
        async with self.pool.acquire() as connection:
            return await connection.execute(query, *args)

    async def _executemany(self, query: str, args: List[tuple]) -> None:
        """Internal method to execute query multiple times"""
        if self.pool is None:
            raise RuntimeError("Database not connected.")
        async with self.pool.acquire() as connection:
            await connection.executemany(query, args)

    @asynccontextmanager
    async def _transaction(self) -> AsyncGenerator[None, None]:
        """Internal method for transaction context manager"""
        if self.pool is None:
            raise RuntimeError("Database not connected.")
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                yield


class SqlAlchemyDatabase(BaseDatabase):
    def __init__(self, config: DbConnectionConfig):
        if not HAS_SQLALCHEMY:
            raise ImportError(
                "SQLAlchemy is not installed. Install it with: pip install sqlalchemy[asyncpg]"
            )
        self.config = config
        self.engine = None

    @classmethod
    async def create(cls, config: DbConnectionConfig) -> "SqlAlchemyDatabase":
        """Create and connect SqlAlchemyDatabase instance"""
        instance = cls(config)
        await instance.connect()
        return instance

    @property
    def is_connected(self) -> bool:
        """Check if engine exists"""
        return self.engine is not None

    async def connect(self) -> None:
        """Create SQLAlchemy async engine"""
        if self.engine is None:
            # Calculate max_overflow: total max - pool_size = additional connections beyond core pool
            max_overflow = max(
                0, self.config.max_connections - self.config.min_connections
            )
            self.engine = create_async_engine(
                self.config.async_connection_url,
                echo=False,
                pool_size=self.config.min_connections,
                max_overflow=max_overflow,
            )

    async def close(self) -> None:
        """Close SQLAlchemy engine"""
        if self.engine:
            await self.engine.dispose()
            self.engine = None

    async def _fetch(self, query: str, *args: Any) -> List[Dict[str, Any]]:
        """Internal method to execute SELECT query and return all rows"""
        if self.engine is None:
            raise RuntimeError(
                "Database not connected. Use SqlAlchemyDatabase.create() to create an instance."
            )
        async with AsyncSession(self.engine) as session:
            result = await session.execute(text(query), args)
            rows = result.fetchall()
            return [row._asdict() for row in rows] if rows else []

    async def _fetchrow(self, query: str, *args: Any) -> Optional[Dict[str, Any]]:
        """Internal method to execute SELECT query and return first row"""
        if self.engine is None:
            raise RuntimeError(
                "Database not connected. Use SqlAlchemyDatabase.create() to create an instance."
            )
        async with AsyncSession(self.engine) as session:
            result = await session.execute(text(query), args)
            row = result.fetchone()
            return row._asdict() if row else None

    async def _execute(self, query: str, *args: Any) -> str:
        """Internal method to execute query and return rowcount"""
        if self.engine is None:
            raise RuntimeError(
                "Database not connected. Use SqlAlchemyDatabase.create() to create an instance."
            )
        async with AsyncSession(self.engine) as session:
            result = await session.execute(text(query), args)
            await session.commit()
            return f"ROWS {getattr(result, 'rowcount', 0)}"

    async def _executemany(self, query: str, args: List[tuple]) -> None:
        """Internal method to execute query multiple times"""
        if self.engine is None:
            raise RuntimeError(
                "Database not connected. Use SqlAlchemyDatabase.create() to create an instance."
            )
        async with AsyncSession(self.engine) as session:
            for arg_tuple in args:
                await session.execute(text(query), arg_tuple)
            await session.commit()

    @asynccontextmanager
    async def _transaction(self) -> AsyncGenerator[None, None]:
        """Internal method for transaction context manager"""
        if self.engine is None:
            raise RuntimeError(
                "Database not connected. Use SqlAlchemyDatabase.create() to create an instance."
            )
        async with AsyncSession(self.engine) as session:
            async with session.begin():
                yield


class Db:
    """Factory class that proxies calls to appropriate database implementation"""

    db_config: DbConnectionConfig
    use_sql_alchemy: bool
    _db_instance: Optional[BaseDatabase]

    def __new__(cls, db_config: DbConnectionConfig, use_sql_alchemy: bool = True):
        # Create a coroutine that will initialize the instance
        return cls._create(db_config, use_sql_alchemy)

    @classmethod
    async def _create(
        cls, db_config: DbConnectionConfig, use_sql_alchemy: bool = True
    ) -> "Db":
        """Internal factory method to create and initialize Db instance"""
        instance = object.__new__(cls)
        instance.db_config = db_config
        instance.use_sql_alchemy = use_sql_alchemy
        instance._db_instance = None
        await instance._initialize_database()
        return instance

    async def _initialize_database(self) -> None:
        """Initialize and connect the database instance"""
        if self.use_sql_alchemy:
            if not HAS_SQLALCHEMY:
                raise ImportError(
                    "SQLAlchemy is not installed. Install it with: pip install sqlalchemy[asyncpg]"
                )
            self._db_instance = await SqlAlchemyDatabase.create(self.db_config)
        else:
            self._db_instance = await AsyncpgDatabase.create(self.db_config)

    @property
    def database(self) -> BaseDatabase:
        """Get the database instance"""
        if self._db_instance is None:
            raise RuntimeError("Database not initialized.")
        return self._db_instance

    def __getattr__(self, name: str) -> Any:
        """Proxy attribute access to the underlying database instance"""
        return getattr(self.database, name)


# Usage Examples:
"""
# Basic Configuration
config = DbConnectionConfig(
    db_host="localhost",
    db_name="mydb", 
    db_username="user",
    db_password="password",
    db_port=5432
)

# Configuration with custom connection pooling
config_with_pooling = DbConnectionConfig(
    db_host="localhost",
    db_name="mydb", 
    db_username="user",
    db_password="password",
    db_port=5432,
    min_connections=2,    # Minimum pool size
    max_connections=20    # Maximum total connections
)

# Using SQLAlchemy implementation (default) - connects during initialization
db_sqlalchemy = await Db(config, use_sql_alchemy=True)

# Using direct asyncpg implementation - connects during initialization
db_asyncpg = await Db(config, use_sql_alchemy=False)

# Using custom pooling configuration - connects with 2-20 connections
db_high_load = await Db(config_with_pooling, use_sql_alchemy=True)

# Both have identical interface - ready to use immediately:
rows = await db_sqlalchemy.fetch("SELECT * FROM users WHERE age > $1", 18)
row = await db_asyncpg.fetchrow("SELECT * FROM users WHERE id = $1", 123)

# Transaction usage - no assert statements, ready to use:
async with db_sqlalchemy.transaction():
    await db_sqlalchemy.execute("INSERT INTO users (name) VALUES ($1)", "John")
    await db_sqlalchemy.execute("UPDATE users SET active = $1 WHERE name = $2", True, "John")

# Batch operations:
users_data = [("Alice", 25), ("Bob", 30), ("Charlie", 35)]
await db_asyncpg.executemany("INSERT INTO users (name, age) VALUES ($1, $2)", users_data)

# Connection status (always True after successful initialization):
print(db_sqlalchemy.is_connected)  # True

# Cleanup
await db_sqlalchemy.close()
await db_asyncpg.close()

# Alternative: Create database instances directly
db_direct_asyncpg = await AsyncpgDatabase.create(config)
db_direct_sqlalchemy = await SqlAlchemyDatabase.create(config)
"""
