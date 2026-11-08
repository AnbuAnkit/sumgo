import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Environment-driven configuration for the agent backend."""

    def __init__(self) -> None:
        self.groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
        self.exa_api_key = os.getenv("EXA_API_KEY", "").strip()
        self.mongodb_uri = os.getenv("MONGODB_URI", "").strip()
        self.mongodb_database = os.getenv("MONGODB_DATABASE", "sumgo").strip()
        self.model = os.getenv("MODEL", "openai/gpt-oss-120b").strip()
        self.max_page_chars = int(os.getenv("MAX_PAGE_CHARS", "12000"))
        self.request_timeout = float(os.getenv("REQUEST_TIMEOUT", "20"))
        self.cors_origins = [
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "*").split(",")
            if origin.strip()
        ]

    def missing_keys(self) -> list[str]:
        """Names of required env vars that are not set."""
        missing = []
        if not self.groq_api_key:
            missing.append("GROQ_API_KEY")
        if not self.exa_api_key:
            missing.append("EXA_API_KEY")
        return missing


settings = Settings()
