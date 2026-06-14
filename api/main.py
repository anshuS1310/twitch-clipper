from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel
import os
import requests
import asyncio
import json
import time
from typing import Dict, List
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections for real-time data streaming"""
    
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, channel: str):
        """Connect a new WebSocket client to a channel"""
        await websocket.accept()
        if channel not in self.active_connections:
            self.active_connections[channel] = []
        self.active_connections[channel].append(websocket)
        logger.info(f"Client connected to channel {channel}. Total connections: {len(self.active_connections[channel])}")
    
    def disconnect(self, websocket: WebSocket, channel: str):
        """Disconnect a WebSocket client from a channel"""
        if channel in self.active_connections:
            try:
                self.active_connections[channel].remove(websocket)
                if not self.active_connections[channel]:
                    del self.active_connections[channel]
                logger.info(f"Client disconnected from channel {channel}")
            except ValueError:
                # WebSocket already removed
                pass
    
    async def broadcast_to_channel(self, channel: str, data: dict):
        """Broadcast data to all connected clients for a channel"""
        if channel in self.active_connections:
            disconnected = []
            for connection in self.active_connections[channel]:
                try:
                    await connection.send_json(data)
                except Exception as e:
                    logger.warning(f"Failed to send data to client: {e}")
                    disconnected.append(connection)
            
            # Clean up disconnected clients
            for connection in disconnected:
                self.disconnect(connection, channel)
    
    def get_connection_count(self) -> int:
        """Get total number of active connections"""
        return sum(len(conns) for conns in self.active_connections.values())

# Global instances
manager = ConnectionManager()
bot_analyzers = {}  # Will be populated by the Twitch bot

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    # Startup
    logger.info("Starting Twitch ML Analytics API...")
    logger.info("API server ready to accept connections")
    yield
    # Shutdown
    logger.info("Shutting down Twitch ML Analytics API...")

app = FastAPI(
    title="Twitch ML Analytics API",
    description="Real-time ML analytics and monitoring for Twitch chat analysis",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Twitch ML Analytics API",
        "status": "running",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/api/channels")
async def get_channels():
    """Get list of currently monitored channels"""
    channels = list(bot_analyzers.keys())
    return {
        "channels": channels,
        "count": len(channels),
        "timestamp": time.time()
    }

@app.get("/api/channels/{channel}/stats")
async def get_channel_stats(channel: str):
    """Get current statistics for a specific channel"""
    if channel not in bot_analyzers:
        raise HTTPException(
            status_code=404, 
            detail=f"Channel '{channel}' is not being monitored"
        )
    
    try:
        analyzer = bot_analyzers[channel]
        stats = analyzer.get_window_stats()
        
        # Enhanced stats with ML metadata
        enhanced_stats = {
            "channel": channel,
            "timestamp": time.time(),
            "stats": stats,
            "ml_status": {
                "model_loaded": len(analyzer.feature_history) >= 100,  # Use constant directly
                "training_samples": len(analyzer.feature_history),  # Show ACTUAL samples, not capped
                "baseline_samples": 60,  # Target baseline samples
                "current_baseline_count": len(analyzer.baseline_velocities),  # Show ACTUAL baseline count
                "model_status": "active" if len(analyzer.feature_history) >= 100 and len(analyzer.baseline_velocities) >= 60 else "training",
                "last_prediction": time.time(),
                "samples_used_for_training": 200 if len(analyzer.feature_history) > 200 else len(analyzer.feature_history)  # NEW: Show what's actually used
            },
            "data_status": {
                "total_messages": getattr(analyzer, 'total_messages_processed', len(analyzer.messages)),  # Fallback for compatibility
                "messages_in_buffer": len(analyzer.messages),  # Add buffer size for debugging
                "emote_window_size": len(analyzer.emote_window),
                "memory_stats": analyzer.emote_spam_detector.get_memory_stats()
            }
        }
        
        return enhanced_stats
        
    except Exception as e:
        logger.error(f"Error getting stats for channel {channel}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve stats for channel '{channel}'"
        )

@app.websocket("/ws/{channel}")
async def websocket_endpoint(websocket: WebSocket, channel: str):
    """WebSocket endpoint for real-time channel data streaming"""
    await manager.connect(websocket, channel)
    
    try:
        logger.info(f"Starting real-time stream for channel: {channel}")
        
        while True:
            if channel in bot_analyzers:
                try:
                    analyzer = bot_analyzers[channel]
                    stats = analyzer.get_window_stats()
                    
                    # Create enhanced real-time data payload
                    data = {
                        "channel": channel,
                        "timestamp": time.time(),
                        "stats": stats,
                        "recent_messages": [
                            {
                                "text": msg["text"][:150],  # Truncate very long messages
                                "user": msg["user_id"],
                                "timestamp": msg["timestamp"].isoformat(),
                                "sentiment": msg.get("sentiment", {}).get("compound", 0)
                            }
                            for msg in list(analyzer.messages)[-5:]  # Last 5 messages
                        ],
                        "ml_metrics": {
                            "feature_count": len(analyzer.feature_history),
                            "model_status": "active" if len(analyzer.feature_history) >= 100 else "training",
                            "baseline_samples": len(analyzer.baseline_velocities),
                            "memory_usage": analyzer.emote_spam_detector.get_memory_stats(),
                            "last_update": time.time()
                        },
                        "connection_info": {
                            "connected_clients": len(manager.active_connections.get(channel, [])),
                            "uptime": time.time()
                        }
                    }
                    
                    await websocket.send_json(data)
                    
                except Exception as e:
                    logger.error(f"Error processing data for channel {channel}: {e}")
                    # Send error notification to client
                    await websocket.send_json({
                        "error": f"Data processing error: {str(e)}",
                        "channel": channel,
                        "timestamp": time.time()
                    })
            else:
                # Channel not available
                await websocket.send_json({
                    "error": f"Channel '{channel}' is not being monitored",
                    "available_channels": list(bot_analyzers.keys()),
                    "timestamp": time.time()
                })
            
            await asyncio.sleep(0.5)  # Update every 500ms
            
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from channel {channel}")
        manager.disconnect(websocket, channel)
    except Exception as e:
        logger.error(f"WebSocket error for channel {channel}: {e}")
        manager.disconnect(websocket, channel)

@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring and load balancers"""
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "uptime": time.time(),  # Will be actual uptime in production
        "services": {
            "api": "running",
            "websockets": "running",
            "ml_analyzers": "running"
        },
        "metrics": {
            "active_channels": len(bot_analyzers),
            "active_connections": manager.get_connection_count(),
            "channels_list": list(bot_analyzers.keys())
        },
        "version": "1.0.0"
    }

@app.get("/api/system/status")
async def system_status():
    """Detailed system status for debugging and monitoring"""
    total_features = sum(len(analyzer.feature_history) for analyzer in bot_analyzers.values())
    total_messages = sum(getattr(analyzer, 'total_messages_processed', len(analyzer.messages)) for analyzer in bot_analyzers.values())  # Use actual total with fallback
    
    return {
        "timestamp": time.time(),
        "channels": {
            channel: {
                "status": "active",
                "feature_count": len(analyzer.feature_history),
                "message_count": getattr(analyzer, 'total_messages_processed', len(analyzer.messages)),  # Use actual total with fallback
                "messages_in_buffer": len(analyzer.messages),  # Add buffer info
                "model_status": "active" if len(analyzer.feature_history) >= 100 else "training",
                "memory_stats": analyzer.emote_spam_detector.get_memory_stats()
            }
            for channel, analyzer in bot_analyzers.items()
        },
        "totals": {
            "channels": len(bot_analyzers),
            "total_features": total_features,
            "total_messages": total_messages,
            "connections": manager.get_connection_count()
        }
    }

# Development endpoint for testing
@app.get("/api/test")
async def test_endpoint():
    """Test endpoint for development and debugging"""
    return {
        "message": "API is working correctly",
        "timestamp": time.time(),
        "analyzers_connected": len(bot_analyzers) > 0,
        "available_endpoints": [
            "/",
            "/health",
            "/api/channels",
            "/api/channels/{channel}/stats",
            "/ws/{channel}",
            "/api/system/status"
        ]
    }

@app.post("/api/register")
async def register_channel(channel: str):
    """Register a new channel for monitoring (lowercase conversion and dynamic joining)"""
    channel = channel.lower().strip()
    if not channel:
        raise HTTPException(status_code=400, detail="Channel name cannot be empty")
        
    from app.chat_analyzer_ml import ChatAnalyzerML
    from app.twitch_bot import active_bot
    
    if channel not in bot_analyzers:
        # Create a new analyzer
        new_analyzer = ChatAnalyzerML(window_size=30, channel=channel)
        bot_analyzers[channel] = new_analyzer
        
        # If bot is running, dynamically update its state and join
        if active_bot:
            active_bot.analyzers[channel] = new_analyzer
            try:
                await active_bot.join_channels([channel])
                logger.info(f"Twitch bot joined channel: {channel}")
            except Exception as e:
                logger.error(f"Error joining channel in bot: {e}")
                
        # Persist the channel list to .env
        try:
            dotenv_path = ".env"
            lines = []
            if os.path.exists(dotenv_path):
                with open(dotenv_path, "r") as f:
                    lines = f.readlines()
                    
            env_dict = {}
            for line in lines:
                if "=" in line and not line.strip().startswith("#"):
                    key, val = line.strip().split("=", 1)
                    env_dict[key.strip()] = val.strip()
            
            current_channels = [c.strip() for c in env_dict.get("TWITCH_CHANNELS", "").split(",") if c.strip()]
            if channel not in current_channels:
                current_channels.append(channel)
                channels_str = ",".join(current_channels)
                env_dict["TWITCH_CHANNELS"] = channels_str
                os.environ["TWITCH_CHANNELS"] = channels_str
                
                # Write back to .env
                with open(dotenv_path, "w") as f:
                    for k, v in env_dict.items():
                        if k == "CLIP_COOLDOWN" or k == "CLIP_DELAY" or k == "CLIP_THRESHOLD":
                            continue
                        f.write(f"{k}={v}\n")
                    # Append settings section
                    f.write("\n# Clip Capture Settings\n")
                    f.write(f"CLIP_COOLDOWN={os.getenv('CLIP_COOLDOWN', '60')}\n")
                    f.write(f"CLIP_DELAY={os.getenv('CLIP_DELAY', '15.0')}\n")
                    f.write(f"CLIP_THRESHOLD={os.getenv('CLIP_THRESHOLD', '0.75')}\n")
        except Exception as e:
            logger.error(f"Failed to persist registered channel to .env: {e}")
            
        logger.info(f"Registered analyzer for channel: {channel}")
        return {
            "success": True,
            "message": f"Successfully registered and joined channel '{channel}'",
            "total_channels": len(bot_analyzers)
        }
    else:
        return {
            "success": False,
            "message": f"Channel '{channel}' already registered",
            "total_channels": len(bot_analyzers)
        }

@app.get("/api/clips")
async def get_clips():
    """Get list of generated clips from the local database file"""
    clips_file = "recordings/clip_urls.txt"
    clips = []
    if os.path.exists(clips_file):
        try:
            with open(clips_file, "r") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) >= 3:
                        clips.append({
                            "url": parts[0],
                            "edit_url": parts[1],
                            "id": parts[2],
                            "embed_url": f"https://clips.twitch.tv/embed?clip={parts[2]}&parent=localhost",
                            "created_at": time.time()
                        })
                    elif len(parts) >= 1 and parts[0]:
                        url = parts[0]
                        clip_id = url.split("/")[-1] if "/" in url else url
                        clips.append({
                            "url": url,
                            "edit_url": "",
                            "id": clip_id,
                            "embed_url": f"https://clips.twitch.tv/embed?clip={clip_id}&parent=localhost",
                            "created_at": time.time()
                        })
        except Exception as e:
            logger.error(f"Error reading clips file: {e}")
            
    clips.reverse()  # Newest clips first
    return {"clips": clips, "count": len(clips)}

@app.get("/api/clips/{clip_id}/download")
async def get_clip_download_url(clip_id: str):
    """Retrieve the direct MP4 download URL and metadata for a specific Twitch clip"""
    try:
        client_id = os.getenv("TWITCH_CLIENT_ID", "")
        access_token = os.getenv("TWITCH_ACCESS_TOKEN", "")
        
        # Try to read credentials from running bot if environment variables are missing
        from app.twitch_bot import active_bot
        if active_bot:
            if not client_id:
                client_id = active_bot.clip_manager.client_id
            if not access_token:
                access_token = active_bot.clip_manager.access_token
                
        if not client_id or not access_token:
            raise HTTPException(status_code=400, detail="Missing Twitch credentials to call API")
            
        headers = {
            'Client-ID': client_id,
            'Authorization': f'Bearer {access_token}'
        }
        
        response = requests.get(f"https://api.twitch.tv/helix/clips?id={clip_id}", headers=headers)
        if response.status_code == 200:
            data = response.json()
            if data.get('data') and len(data['data']) > 0:
                clip_data = data['data'][0]
                thumbnail_url = clip_data.get('thumbnail_url', '')
                
                # Retrieve direct mp4 URL from thumbnail
                mp4_url = ""
                if thumbnail_url:
                    if "-preview-" in thumbnail_url:
                        mp4_url = thumbnail_url.split("-preview-")[0] + ".mp4"
                    else:
                        mp4_url = thumbnail_url.replace("-preview-480x272.jpg", ".mp4")
                        
                return {
                    "clip_id": clip_id,
                    "download_url": mp4_url,
                    "title": clip_data.get("title", "Twitch Highlight"),
                    "broadcaster_name": clip_data.get("broadcaster_name", ""),
                    "view_count": clip_data.get("view_count", 0),
                    "duration": clip_data.get("duration", 0.0)
                }
        raise HTTPException(status_code=404, detail="Clip not found on Twitch")
    except Exception as e:
        logger.error(f"Error fetching download link for clip {clip_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/clips/{clip_id}")
async def delete_clip(clip_id: str):
    """Delete a clip from the local catalog file and synchronise bot memory"""
    clips_file = "recordings/clip_urls.txt"
    if not os.path.exists(clips_file):
        raise HTTPException(status_code=404, detail="No clips database found")
        
    try:
        # Read all existing clips
        lines = []
        with open(clips_file, "r") as f:
            lines = f.readlines()
            
        # Filter out the matching clip
        new_lines = []
        found = False
        for line in lines:
            parts = line.strip().split("\t")
            if len(parts) >= 3 and parts[2] == clip_id:
                found = True
                continue
            elif len(parts) >= 1 and clip_id in parts[0]:
                found = True
                continue
            new_lines.append(line)
            
        if not found:
            raise HTTPException(status_code=404, detail="Clip not found in catalog")
            
        # Write back to file
        with open(clips_file, "w") as f:
            f.writelines(new_lines)
            
        # Sync with running bot memory
        from app.twitch_bot import active_bot
        if active_bot and hasattr(active_bot, 'clip_manager'):
            active_bot.clip_manager.clip_urls = [
                clip for clip in active_bot.clip_manager.clip_urls
                if (isinstance(clip, dict) and clip.get('id') != clip_id) or
                   (isinstance(clip, str) and clip_id not in clip)
            ]
            
        return {"success": True, "message": f"Clip {clip_id} successfully deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting clip {clip_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
async def get_settings():
    """Retrieve current system configuration settings"""
    from app.twitch_bot import active_bot
    
    clip_threshold = 0.75
    cooldown = 60
    delay = 15.0
    if active_bot:
        clip_threshold = getattr(active_bot, "clip_threshold", 0.75)
        cooldown = getattr(active_bot, "cooldown_period", 60)
        delay = getattr(active_bot, "clip_delay", 15.0)
    else:
        clip_threshold = float(os.getenv("CLIP_THRESHOLD", "0.75"))
        cooldown = int(os.getenv("CLIP_COOLDOWN", "60"))
        delay = float(os.getenv("CLIP_DELAY", "15.0"))
        
    return {
        "twitch_username": os.getenv("TWITCH_BOT_USERNAME", ""),
        "twitch_client_id": os.getenv("TWITCH_CLIENT_ID", ""),
        "twitch_client_secret": os.getenv("TWITCH_CLIENT_SECRET", ""),
        "twitch_refresh_token": os.getenv("TWITCH_REFRESH_TOKEN", ""),
        "twitch_access_token": os.getenv("TWITCH_ACCESS_TOKEN", ""),
        "twitch_channels": os.getenv("TWITCH_CHANNELS", ""),
        "clip_threshold": clip_threshold,
        "clip_cooldown": cooldown,
        "clip_delay": delay
    }

class SettingsUpdate(BaseModel):
    twitch_username: str
    twitch_client_id: str
    twitch_client_secret: str
    twitch_refresh_token: str
    twitch_access_token: str
    clip_threshold: float
    clip_cooldown: int
    clip_delay: float

@app.post("/api/settings")
async def update_settings(settings: SettingsUpdate):
    """Update configuration settings in memory and write to the .env file"""
    try:
        dotenv_path = ".env"
        lines = []
        if os.path.exists(dotenv_path):
            with open(dotenv_path, "r") as f:
                lines = f.readlines()
                
        env_dict = {}
        for line in lines:
            if "=" in line and not line.strip().startswith("#"):
                key, val = line.strip().split("=", 1)
                env_dict[key.strip()] = val.strip()
                
        env_dict["TWITCH_BOT_USERNAME"] = settings.twitch_username
        env_dict["TWITCH_CLIENT_ID"] = settings.twitch_client_id
        env_dict["TWITCH_CLIENT_SECRET"] = settings.twitch_client_secret
        env_dict["TWITCH_REFRESH_TOKEN"] = settings.twitch_refresh_token
        env_dict["TWITCH_ACCESS_TOKEN"] = settings.twitch_access_token
        env_dict["CLIP_THRESHOLD"] = str(settings.clip_threshold)
        env_dict["CLIP_COOLDOWN"] = str(settings.clip_cooldown)
        env_dict["CLIP_DELAY"] = str(settings.clip_delay)
        
        with open(dotenv_path, "w") as f:
            f.write(f"TWITCH_CLIENT_ID={env_dict['TWITCH_CLIENT_ID']}\n")
            f.write(f"TWITCH_CLIENT_SECRET={env_dict['TWITCH_CLIENT_SECRET']}\n")
            f.write(f"TWITCH_ACCESS_TOKEN={env_dict['TWITCH_ACCESS_TOKEN']}\n")
            f.write(f"TWITCH_REFRESH_TOKEN={env_dict['TWITCH_REFRESH_TOKEN']}\n")
            f.write(f"TWITCH_CHANNELS={env_dict.get('TWITCH_CHANNELS', '')}\n")
            f.write(f"TWITCH_BOT_USERNAME={env_dict['TWITCH_BOT_USERNAME']}\n\n")
            f.write("# Clip Capture Settings\n")
            f.write(f"CLIP_COOLDOWN={env_dict['CLIP_COOLDOWN']}\n")
            f.write(f"CLIP_DELAY={env_dict['CLIP_DELAY']}\n")
            f.write(f"CLIP_THRESHOLD={env_dict['CLIP_THRESHOLD']}\n")
            
        os.environ["TWITCH_BOT_USERNAME"] = settings.twitch_username
        os.environ["TWITCH_CLIENT_ID"] = settings.twitch_client_id
        os.environ["TWITCH_CLIENT_SECRET"] = settings.twitch_client_secret
        os.environ["TWITCH_REFRESH_TOKEN"] = settings.twitch_refresh_token
        os.environ["TWITCH_ACCESS_TOKEN"] = settings.twitch_access_token
        os.environ["CLIP_THRESHOLD"] = str(settings.clip_threshold)
        os.environ["CLIP_COOLDOWN"] = str(settings.clip_cooldown)
        os.environ["CLIP_DELAY"] = str(settings.clip_delay)
        
        from app.twitch_bot import active_bot
        if active_bot:
            active_bot.cooldown_period = settings.clip_cooldown
            active_bot.clip_delay = settings.clip_delay
            active_bot.clip_threshold = settings.clip_threshold
            active_bot.clip_manager.client_id = settings.twitch_client_id
            active_bot.clip_manager.client_secret = settings.twitch_client_secret
            active_bot.clip_manager.access_token = settings.twitch_access_token
            active_bot.clip_manager.cooldown_period = settings.clip_cooldown
            
        return {"success": True, "message": "Settings updated successfully"}
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info"
    ) 