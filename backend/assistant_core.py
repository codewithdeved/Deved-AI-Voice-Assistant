import logging
from datetime import datetime
from typing import Dict, List
import os
from dotenv import load_dotenv
import requests
from requests.exceptions import RequestException

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)


class Cache:

    def __init__(self, max_size: int = 1000):
        self._cache = {}
        self._max_size = max_size

    def __contains__(self, key: str) -> bool:
        return key in self._cache

    def __getitem__(self, key: str):
        return self._cache[key]

    def __setitem__(self, key: str, val: Dict) -> None:
        if len(self._cache) >= self._max_size:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = val


class AssistantCore:

    def __init__(self, gemini_api_key: str = None, elevenlabs_api_key: str = None):
        load_dotenv()
        self.gemini_api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
        self.elevenlabs_api_key = elevenlabs_api_key or os.getenv("ELEVENLABS_API_KEY")

        if not self.gemini_api_key:
            logging.error("Gemini API key not provided.")
            raise ValueError("Gemini API key is required.")
        if not self.elevenlabs_api_key:
            logging.warning(
                "ElevenLabs API key not provided. Audio generation will be disabled."
            )

        self.elevenlabs_voice_id = "FmBhnvP58BK0vz65OOj7"
        self.gemini_api_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        self.conversations = {}
        self.cache = Cache()
        self.audio_files = set()
        self.max_audio_files = 50

    def _cleanup_audio_files(self):
        if len(self.audio_files) >= self.max_audio_files:
            files_to_remove = sorted(self.audio_files, key=os.path.getctime)[
                : -self.max_audio_files + 10
            ]
            for file in files_to_remove:
                if os.path.exists(file):
                    os.remove(file)
                    self.audio_files.remove(file)
                    logging.info(f"Cleaned up audio response: {file}")

    def _build_conversation_context(
        self, user_id: str, current_message: str
    ) -> List[Dict]:
        if user_id not in self.conversations:
            return [{"role": "user", "parts": [{"text": current_message}]}]

        recent_history = (
            self.conversations[user_id][-8:]
            if len(self.conversations[user_id]) > 8
            else self.conversations[user_id]
        )
        contents = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": """You are Deved, an AI voice assistant. You understand both English and Roman Urdu perfectly. 
                                    When someone speaks in Roman Urdu, respond in Roman Urdu. You're excellent at:
                                    - Writing and explaining code in multiple programming languages
                                    - Having natural conversations in both languages
                                    - Helping with technical questions
                                    - Keeping responses conversational and concise for voice interaction
                                    Common Roman Urdu phrases:
                                    - "Mujhe help chahiye" = I need help
                                    - "Code likhiye" = Write code  
                                    - "Samjhaiye" = Explain
                                    - "Kya hai ye" = What is this
                                    - "Kaise karte hain" = How to do this
                                    - "Python mein" = In Python
                                    - "JavaScript ka" = JavaScript's
                                    - "Function banao" = Create function
                                    Always provide complete and detailed responses that fully address the user's query. If the response is incomplete, ask clarifying questions to ensure accuracy and completeness."""
                    }
                ],
            },
            {
                "role": "model",
                "parts": [
                    {
                        "text": "Bilkul! Main aap ki help kar sakta hun English aur Roman Urdu dono mein. Code likhna ho ya koi technical sawal ho, bas puchiye! Main har jawab ko mukammal aur poora rakhunga."
                    }
                ],
            },
        ]
        for msg in recent_history:
            contents.append(
                {
                    "role": "user" if msg["role"] == "user" else "model",
                    "parts": [{"text": msg["content"]}],
                }
            )
        contents.append({"role": "user", "parts": [{"text": current_message}]})

        return contents

    def _generate_response(self, message: str, user_id: str = "default") -> Dict:
        message = message.replace("/think", "").replace("/no_think", "").strip()
        try:
            contents = self._build_conversation_context(user_id, message)
            payload = {
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.7,
                    "topK": 40,
                    "topP": 0.95,
                    "maxOutputTokens": 1000,
                    "stopSequences": [],
                },
                "safetySettings": [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE",
                    },
                ],
            }

            url = f"{self.gemini_api_url}?key={self.gemini_api_key}"
            response = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            response.raise_for_status()
            result = response.json()

            if "candidates" in result and result["candidates"]:
                content = result["candidates"][0]["content"]["parts"][0].get(
                    "text", "Sorry, I couldn't generate a response."
                )
                # Ensure the response is complete by checking if it fully addresses the query
                if not self._is_response_complete(message, content):
                    content += "\n\nPlease let me know if you need more details or clarification on any part of this response!"
            else:
                content = "Sorry, I couldn't generate a response. Please try again or provide more context."

            return {
                "response": content.strip(),
                "status": "success",
            }

        except RequestException as e:
            logging.error(f"Gemini API error: {str(e)}")
            return {
                "response": "Error: Failed to generate response - please check API configuration.",
                "status": "error",
            }
        except Exception as e:
            logging.error(f"Unexpected error in _generate_response: {str(e)}")
            return {
                "response": "Error: An unexpected error occurred.",
                "status": "error",
            }

    def _is_response_complete(self, query: str, response: str) -> bool:
        query_keywords = set(query.lower().split())
        response_keywords = set(response.lower().split())
        missing_keywords = query_keywords - response_keywords
        if missing_keywords:
            return False
        if len(response.split()) < len(query.split()) * 0.5:
            return False
        return True

    def _generate_audio(self, text: str) -> str:
        if not self.elevenlabs_api_key:
            logging.warning(
                "ElevenLabs API key not provided. Skipping audio generation."
            )
            return ""

        try:
            headers = {
                "xi-api-key": self.elevenlabs_api_key,
                "Content-Type": "application/json",
            }
            voice_id = self.elevenlabs_voice_id
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
            payload = {"text": text, "model_id": "eleven_multilingual_v2"}

            response = requests.post(url, headers=headers, json=payload, timeout=15)
            response.raise_for_status()

            audio_filename = f"response_{int(datetime.now().timestamp())}.mp3"
            audio_dir = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "audio")
            )
            if not os.path.exists(audio_dir):
                os.makedirs(audio_dir)

            audio_path = os.path.join(audio_dir, audio_filename)

            with open(audio_path, "wb") as f:
                f.write(response.content)

            if os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
                self.audio_files.add(audio_path)
                self._cleanup_audio_files()
                logging.info(f"Audio generated successfully: {audio_path}")
                return audio_path
            else:
                os.remove(audio_path) if os.path.exists(audio_path) else None
                logging.error("Generated audio file is empty or invalid.")
                return ""
        except Exception as e:
            logging.error(f"ElevenLabs TTS error: {str(e)}")
            return ""

    def chat(self, message: str, user_id: str = "default") -> Dict:
        cache_key = f"{user_id}:{message}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        if user_id not in self.conversations:
            self.conversations[user_id] = []
        self.conversations[user_id].append({"role": "user", "content": message})

        result = self._generate_response(message, user_id)
        response_text = result["response"]
        status = result["status"]

        self.conversations[user_id].append(
            {"role": "assistant", "content": response_text}
        )
        if len(self.conversations[user_id]) > 10:
            self.conversations[user_id] = self.conversations[user_id][-10:]

        audio_path = (
            self._generate_audio(response_text) if self.elevenlabs_api_key else ""
        )
        result = {
            "response": response_text,
            "audio_path": audio_path,
            "timestamp": datetime.now().isoformat(),
            "status": status,
            "language_detected": self._detect_language(message),
        }
        self.cache[cache_key] = result
        return result

    def _detect_language(self, text: str) -> str:
        roman_urdu_words = [
            "mujhe",
            "kya",
            "hai",
            "aap",
            "kaise",
            "karte",
            "hain",
            "chahiye",
            "samjhaiye",
            "likhiye",
            "banao",
            "mein",
            "python",
            "javascript",
            "code",
            "function",
            "help",
        ]
        text_lower = text.lower()
        roman_urdu_count = sum(1 for word in roman_urdu_words if word in text_lower)
        return "roman_urdu" if roman_urdu_count >= 2 else "en"
