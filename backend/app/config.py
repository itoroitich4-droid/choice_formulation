from functools import lru_cache
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    # Supabase Postgres connection string (use the pooler "transaction" URL in production).
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    # https://<project-ref>.supabase.co  - used to fetch the JWT signing keys (JWKS).
    supabase_url: str = ""
    # Only for projects that still sign tokens with the legacy shared HS256 secret.
    supabase_jwt_secret: str = ""
    jwt_audience: str = "authenticated"
    # Comma separated list of browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"
    db_pool_max: int = 10

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def validate_production(self) -> None:
        supabase = urlparse(self.supabase_url)
        if supabase.scheme != "https" or not supabase.netloc:
            raise RuntimeError("Production requires SUPABASE_URL to use HTTPS.")
        origins = [urlparse(origin) for origin in self.cors_list]
        if not origins or any(origin.scheme != "https" or not origin.netloc or origin.path not in ("", "/")
                              for origin in origins):
            raise RuntimeError("Production CORS_ORIGINS must list only explicit HTTPS web-app origins.")
        database_host = urlparse(self.database_url).hostname
        if not database_host or database_host.lower() in {"localhost", "127.0.0.1", "::1"}:
            raise RuntimeError("Production requires a configured Supabase DATABASE_URL.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
