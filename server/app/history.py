"""MongoDB persistence for conversations."""

from datetime import datetime, timezone
from threading import Lock
from typing import Any

from pymongo import DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .config import settings
from .schemas import ConversationDetail, ConversationSummary, StoredMessage

_client: MongoClient[dict[str, Any]] | None = None
_collection: Collection[dict[str, Any]] | None = None
_collection_lock = Lock()


class HistoryStoreError(Exception):
    """Raised when conversation persistence is not configured or available."""


def _get_collection() -> Collection[dict[str, Any]]:
    global _client, _collection

    if not settings.mongodb_uri:
        raise HistoryStoreError("Set MONGODB_URI in server/.env to enable conversation history.")

    if _collection is None:
        with _collection_lock:
            if _collection is None:
                try:
                    _client = MongoClient(
                        settings.mongodb_uri,
                        serverSelectionTimeoutMS=5000,
                        tz_aware=True,
                    )
                    collection = _client[settings.mongodb_database]["conversations"]
                    collection.create_index([("updated_at", DESCENDING)])
                    _collection = collection
                except PyMongoError as exc:
                    if _client is not None:
                        _client.close()
                    _client = None
                    raise HistoryStoreError(
                        f"MongoDB is unavailable ({type(exc).__name__}). Check MONGODB_URI."
                    ) from exc

    return _collection


def _handle_database_error(exc: PyMongoError) -> HistoryStoreError:
    return HistoryStoreError(
        f"MongoDB is unavailable ({type(exc).__name__}). Check MONGODB_URI."
    )


def _summary(document: dict[str, Any]) -> ConversationSummary:
    return ConversationSummary(
        id=document["_id"],
        title=document.get("title", "New conversation"),
        updated_at=document["updated_at"].isoformat(),
    )


def list_conversations() -> list[ConversationSummary]:
    try:
        documents = _get_collection().find(
            {}, {"title": 1, "updated_at": 1}
        ).sort("updated_at", DESCENDING)
        return [_summary(document) for document in documents]
    except PyMongoError as exc:
        raise _handle_database_error(exc) from exc


def get_conversation(conversation_id: str) -> ConversationDetail | None:
    try:
        document = _get_collection().find_one({"_id": conversation_id})
    except PyMongoError as exc:
        raise _handle_database_error(exc) from exc

    if document is None:
        return None

    return ConversationDetail(
        **_summary(document).model_dump(),
        messages=[StoredMessage.model_validate(message) for message in document["messages"]],
    )


def save_pending_messages(
    conversation_id: str, messages: list[StoredMessage]
) -> None:
    now = datetime.now(timezone.utc)
    title = next((message.content.strip() for message in messages if message.role == "user"), "")
    title = title[:80] or "New conversation"
    try:
        _get_collection().update_one(
            {"_id": conversation_id},
            {
                "$set": {
                    "messages": [message.model_dump(mode="json") for message in messages],
                    "updated_at": now,
                },
                "$setOnInsert": {"title": title, "created_at": now},
            },
            upsert=True,
        )
    except PyMongoError as exc:
        raise _handle_database_error(exc) from exc


def append_assistant_message(
    conversation_id: str, message: StoredMessage
) -> None:
    try:
        _get_collection().update_one(
            {"_id": conversation_id},
            {
                "$push": {"messages": message.model_dump(mode="json")},
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
    except PyMongoError as exc:
        raise _handle_database_error(exc) from exc


def delete_conversation(conversation_id: str) -> bool:
    try:
        result = _get_collection().delete_one({"_id": conversation_id})
    except PyMongoError as exc:
        raise _handle_database_error(exc) from exc
    return result.deleted_count > 0
