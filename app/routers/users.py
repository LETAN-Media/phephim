from fastapi import APIRouter
from app.services import users_handlers as handlers

router = APIRouter()

router.add_api_route('/api/auth/me', handlers.me, methods=["GET"])
router.add_api_route('/api/users/me', handlers.me, methods=["GET"])
router.add_api_route('/api/users/me', handlers.profile, methods=["PATCH"])
