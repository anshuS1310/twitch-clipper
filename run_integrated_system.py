#!/usr/bin/env python3
"""
Integrated Live System - Run API and Bot in the same process
This ensures real-time data sharing between the bot and API
"""

import os
import asyncio
import logging
import uvicorn
import threading
import time
import requests
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

# Load environment variables from .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path, override=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def check_api_running():
    """Check if API is already running"""
    try:
        response = requests.get("http://localhost:8000/health", timeout=2)
        return response.status_code == 200
    except Exception:
        return False

async def run_bot():
    """Run the Twitch bot"""
    logger.info("🤖 Starting Twitch bot...")
    from app.twitch_bot import main_async
    await main_async()

def run_api_server():
    """Run the FastAPI server"""
    logger.info("🚀 Starting API server...")
    from api.main import app
    
    port = int(os.getenv("PORT", "8000"))
    config = uvicorn.Config(
        app=app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
    server = uvicorn.Server(config)
    
    # Run server in event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        loop.run_until_complete(server.serve())
    except OSError as e:
        if "address already in use" in str(e):
            logger.info("📡 API server already running on port 8000")
        else:
            logger.error(f"❌ API server error: {e}")

async def main():
    """Run both API and bot integrated"""
    logger.info("🌟 Starting integrated live Twitch analytics system...")
    
    # Validate and refresh Twitch token before starting the services
    try:
        from app.token_helper import validate_and_refresh_token
        logger.info("🔑 Running startup token check...")
        if not validate_and_refresh_token():
            logger.error("❌ Token validation/refresh failed. Bot connection may fail.")
        else:
            logger.info("✅ Startup token check passed.")
    except Exception as e:
        logger.error(f"❌ Error during token verification on startup: {e}")
        
    # Check if API is already running
    if check_api_running():
        logger.info("📡 API server already running - using existing instance")
    else:
        # Start API server in a separate thread
        logger.info("🚀 Starting new API server...")
        api_thread = threading.Thread(target=run_api_server, daemon=True)
        api_thread.start()
        
        # Wait for API to start
        logger.info("⏳ Waiting for API server to initialize...")
        await asyncio.sleep(3)
    
    # Verify API is accessible
    try:
        response = requests.get("http://localhost:8000/health", timeout=5)
        if response.status_code == 200:
            logger.info("✅ API server is ready and accessible")
        else:
            logger.warning(f"⚠️ API health check returned: {response.status_code}")
    except Exception as e:
        logger.warning(f"⚠️ Could not verify API status: {e}")
    
    logger.info("🔗 Starting bot with API integration...")
    
    try:
        # Run bot in main event loop
        await run_bot()
    except KeyboardInterrupt:
        logger.info("🛑 System stopped by user")
    except Exception as e:
        logger.error(f"❌ System error: {e}")
        raise
    
    logger.info("✅ Integrated system shutdown complete")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🏁 System interrupted by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        raise 