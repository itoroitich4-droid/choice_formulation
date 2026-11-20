from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
