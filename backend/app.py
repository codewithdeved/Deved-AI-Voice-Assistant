from flask import Flask, jsonify, send_file, request
from flask_cors import CORS
import logging
from datetime import datetime
import os
import re
from assistant_core import AssistantCore

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

app = Flask(__name__)

CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501,http://localhost:3000,http://127.0.0.1:3000",
).split(",")

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": CORS_ORIGINS,
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
            "supports_credentials": True,
        }
    },
)

AUDIO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "audio"))
if not os.path.exists(AUDIO_DIR):
    os.makedirs(AUDIO_DIR)

try:
    assistant = AssistantCore()
except Exception as e:
    logging.error(f"Failed to initialize AssistantCore: {e}")
    assistant = None

@app.errorhandler(500)
def internal_error(e):
    logging.error(f"Internal server error: {str(e)}")
    return (
        jsonify(
            {
                "error": "Internal server error. Please check server logs.",
                "status": "error",
            }
        ),
        500,
    )

@app.route("/api/health", methods=["GET"])
def health_check():
    try:
        return (
            jsonify(
                {
                    "status": "healthy" if assistant else "degraded",
                    "timestamp": datetime.now().isoformat(),
                    "service": "Deved Assistant API",
                    "assistant_ready": assistant is not None,
                }
            ),
            200,
        )
    except Exception as e:
        logging.error(f"Health check failed: {str(e)}")
        return jsonify({"status": "unhealthy", "error": str(e)}), 500

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        if not assistant:
            return (
                jsonify(
                    {"error": "Assistant not properly initialized", "status": "error"}
                ),
                503,
            )

        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided", "status": "error"}), 400

        message = data.get("message", "").strip()
        user_id = data.get("user_id", "default").strip()

        if not re.match(r"^[a-zA-Z0-9_-]{1,50}$", user_id):
            return (
                jsonify(
                    {
                        "error": "Invalid user_id. Use alphanumeric characters, underscores, or hyphens (max 50 chars).",
                        "status": "error",
                    }
                ),
                400,
            )

        if not message:
            return jsonify({"error": "No message provided", "status": "error"}), 400

        result = assistant.chat(message, user_id)
        language_detected = result.get("language_detected", "en")

        audio_filename = ""
        if result.get("audio_path"):
            audio_filename = os.path.basename(result.get("audio_path"))
            full_audio_path = os.path.join(AUDIO_DIR, audio_filename)
            if not os.path.exists(full_audio_path):
                logging.warning(f"Audio file not found: {full_audio_path}")
                audio_filename = ""

        response_data = {
            "response": result.get("response", ""),
            "audio_path": audio_filename,
            "timestamp": result.get("timestamp", datetime.now().isoformat()),
            "status": result.get("status", "success"),
            "language_detected": language_detected,
        }

        if not response_data["response"]:
            response_data["response"] = (
                "Maaf kijiye, main ek theek jawab generate nahi kar saka."
                if language_detected == "roman_urdu"
                else "I apologize, but I couldn't generate a proper response."
            )
            response_data["status"] = "partial_failure"

        logging.info(
            f"Chat response prepared for user_id={user_id}, language={language_detected}: "
            f"{len(response_data['response'])} chars, audio={bool(audio_filename)}"
        )

        return jsonify(response_data), 200

    except Exception as e:
        logging.error(f"Error in chat endpoint: {str(e)}")
        logging.error(f"Error traceback: {traceback.format_exc()}")

        language_detected = data.get("language_detected", "en") if data else "en"
        return (
            jsonify(
                {
                    "error": "Failed to process chat message",
                    "status": "error",
                    "details": str(e),
                    "response": (
                        "Maaf kijiye, aap ke request ko process karte waqt error hua."
                        if language_detected == "roman_urdu"
                        else "I apologize, but I encountered an error processing your request."
                    ),
                }
            ),
            500,
        )

@app.route("/api/audio/<filename>", methods=["GET"])
def serve_audio(filename):
    try:
        audio_path = os.path.join(AUDIO_DIR, filename)
        if not os.path.exists(audio_path):
            return jsonify({"error": "Audio file not found", "status": "error"}), 404

        # Security check
        if not os.path.abspath(audio_path).startswith(AUDIO_DIR):
            return jsonify({"error": "Invalid audio file path", "status": "error"}), 403

        response = send_file(audio_path, mimetype="audio/mpeg")

        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, post-check=0, pre-check=0",
        )
        response.headers.add("Pragma", "no-cache")
        response.headers.add("Expires", "0")

        return response
    except Exception as e:
        logging.error(f"Error serving audio file {filename}: {str(e)}")
        return (
            jsonify(
                {
                    "error": "Failed to serve audio file",
                    "status": "error",
                    "details": str(e),
                }
            ),
            500,
        )

@app.route("/api/status", methods=["GET"])
def get_status():
    try:
        return (
            jsonify(
                {
                    "status": "online" if assistant else "degraded",
                    "features": {
                        "text_chat": assistant is not None,
                        "voice_synthesis": bool(
                            assistant and assistant.elevenlabs_api_key
                        ),
                    },
                    "timestamp": datetime.now().isoformat(),
                    "assistant_initialized": assistant is not None,
                }
            ),
            200,
        )
    except Exception as e:
        logging.error(f"Error in status endpoint: {str(e)}")
        return jsonify({"error": "Failed to get status", "status": "error"}), 500

if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
    except Exception as e:
        logging.error(f"Failed to start server: {str(e)}")