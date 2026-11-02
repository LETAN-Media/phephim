from fastapi import APIRouter
from app.services import auth_handlers as handlers

router = APIRouter()

router.add_api_route('/api/auth/register', handlers.register, status_code=201, methods=["POST"])
router.add_api_route('/api/auth/login', handlers.login, methods=["POST"])
router.add_api_route('/api/auth/logout', handlers.logout, methods=["POST"])
router.add_api_route('/api/auth/change-password', handlers.change_password, methods=["POST"])
router.add_api_route('/api/auth/forgot-password', handlers.forgot, methods=["POST"])
router.add_api_route('/api/auth/reset-password', handlers.reset, methods=["POST"])
router.add_api_route('/api/auth/verify-email', handlers.verify, methods=["POST"])
