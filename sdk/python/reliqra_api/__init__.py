"""Standard-library Python client for the Reliqra API."""
from .client import DEFAULT_BASE_URL, ReliqraClient
from .errors import ReliqraConfigError, ReliqraError

__all__ = ["ReliqraClient", "ReliqraError", "ReliqraConfigError", "DEFAULT_BASE_URL"]
__version__ = "0.1.0"
