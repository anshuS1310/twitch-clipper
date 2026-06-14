import os
import logging
import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

def validate_token(access_token):
    """
    Validates the Twitch OAuth access token.
    Returns (is_valid, expires_in, response_json)
    """
    if not access_token:
        return False, 0, None
        
    headers = {
        "Authorization": f"OAuth {access_token}"
    }
    
    try:
        response = requests.get("https://id.twitch.tv/oauth2/validate", headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            expires_in = data.get("expires_in", 0)
            return True, expires_in, data
        else:
            logger.warning(f"Token validation failed with status {response.status_code}: {response.text}")
            return False, 0, None
    except Exception as e:
        logger.error(f"Error validating token: {e}")
        return False, 0, None

def refresh_token_twitch(client_id, client_secret, refresh_token):
    """
    Refreshes the Twitch OAuth access token using official Twitch API.
    Returns (success, new_access_token, new_refresh_token)
    """
    url = "https://id.twitch.tv/oauth2/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token
    }
    
    try:
        response = requests.post(url, data=data, timeout=10)
        if response.status_code == 200:
            res_data = response.json()
            new_access = res_data.get("access_token")
            new_refresh = res_data.get("refresh_token")
            return True, new_access, new_refresh
        else:
            logger.warning(f"Twitch API refresh failed (status {response.status_code}): {response.text}")
            return False, None, None
    except Exception as e:
        logger.error(f"Error during Twitch API refresh: {e}")
        return False, None, None

def refresh_token_generator(refresh_token):
    """
    Refreshes the Twitch OAuth access token using TwitchTokenGenerator.com API.
    Returns (success, new_access_token, new_refresh_token)
    """
    url = f"https://twitchtokengenerator.com/api/refresh/{refresh_token}"
    
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            res_data = response.json()
            if res_data.get("success"):
                new_access = res_data.get("access_token")
                new_refresh = res_data.get("refresh_token")
                return True, new_access, new_refresh
            else:
                logger.warning(f"TwitchTokenGenerator refresh success=False: {res_data}")
                return False, None, None
        else:
            logger.warning(f"TwitchTokenGenerator API failed (status {response.status_code}): {response.text}")
            return False, None, None
    except Exception as e:
        logger.error(f"Error during TwitchTokenGenerator refresh: {e}")
        return False, None, None

def update_env_file(env_path, updates):
    """
    Updates specific keys in the .env file while preserving other content/formatting.
    """
    if not os.path.exists(env_path):
        with open(env_path, 'w', encoding='utf-8') as f:
            for k, v in updates.items():
                f.write(f"{k}={v}\n")
        return
        
    with open(env_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    new_lines = []
    updated_keys = set()
    
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            new_lines.append(line)
            continue
            
        if '=' in stripped:
            key, val = stripped.split('=', 1)
            key = key.strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}\n")
                updated_keys.add(key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)
            
    for key, val in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={val}\n")
            
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

def validate_and_refresh_token():
    """
    Main entry point. Validates access token and refreshes it if needed.
    Returns True if token is valid (or successfully refreshed), False otherwise.
    """
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    load_dotenv(env_path, override=True)
    
    client_id = os.getenv("TWITCH_CLIENT_ID")
    client_secret = os.getenv("TWITCH_CLIENT_SECRET")
    access_token = os.getenv("TWITCH_ACCESS_TOKEN")
    refresh_token = os.getenv("TWITCH_REFRESH_TOKEN")
    
    if not access_token:
        logger.error("No TWITCH_ACCESS_TOKEN found in environment or .env file.")
        return False
        
    logger.info("Checking Twitch access token status...")
    is_valid, expires_in, val_data = validate_token(access_token)
    
    # If valid and has more than 5 minutes (300 seconds) left, or is a permanent token (expires_in == 0), we're good
    if is_valid and (expires_in > 300 or expires_in == 0):
        if expires_in == 0:
            logger.info("Twitch access token is valid (permanent/non-expiring token).")
        else:
            logger.info(f"Twitch access token is valid. Expires in {expires_in} seconds (~{expires_in // 60} minutes).")
        return True
        
    if is_valid:
        logger.info(f"Twitch access token is close to expiration ({expires_in}s remaining). Refreshing...")
    else:
        logger.info("Twitch access token is invalid or expired. Refreshing...")
        
    if not refresh_token:
        logger.error("Cannot refresh token: TWITCH_REFRESH_TOKEN is missing from .env")
        return False
        
    refreshed = False
    new_access = None
    new_refresh = None
    
    # 1. Try official Twitch API flow if client secret is set
    if client_secret:
        logger.info("Attempting official Twitch API token refresh...")
        refreshed, new_access, new_refresh = refresh_token_twitch(client_id, client_secret, refresh_token)
        
    # 2. Fall back to TwitchTokenGenerator API if official flow wasn't tried or failed
    if not refreshed:
        logger.info("Attempting TwitchTokenGenerator API token refresh...")
        refreshed, new_access, new_refresh = refresh_token_generator(refresh_token)
        
    if refreshed and new_access:
        logger.info("Successfully refreshed Twitch OAuth token!")
        updates = {
            "TWITCH_ACCESS_TOKEN": new_access
        }
        if new_refresh:
            updates["TWITCH_REFRESH_TOKEN"] = new_refresh
            
        update_env_file(env_path, updates)
        
        # Update current process environment
        os.environ["TWITCH_ACCESS_TOKEN"] = new_access
        if new_refresh:
            os.environ["TWITCH_REFRESH_TOKEN"] = new_refresh
            
        # Re-apply load_dotenv to make sure any libraries or modules reload the env
        load_dotenv(env_path, override=True)
        return True
    else:
        logger.error("❌ Failed to refresh Twitch OAuth access token.")
        return False
