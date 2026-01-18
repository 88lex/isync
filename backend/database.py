import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Database file path
DB_PATH = os.environ.get("ISYNC_DB_PATH", "isync.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Create engine and session
# check_same_thread=False is needed for SQLite with FastAPI multi-threading
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Dependency for getting DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize the database tables."""
    Base.metadata.create_all(bind=engine)
