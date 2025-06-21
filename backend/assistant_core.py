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
            self, user_id: str, current_message: str, language: str
        ) -> List[Dict]:
            if user_id not in self.conversations:
                self.conversations[user_id] = []

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
                            "text": f"""You are Deved, an AI voice assistant. You understand both English and Roman Urdu perfectly. 
                                        Respond in the same language as the user's query, which is detected as {language}. 
                                        If the query is in Roman Urdu, respond ONLY in Roman Urdu (e.g., 'Assalamu Alaikum! Main acha hun.'), 
                                        avoiding pure Urdu script (e.g., 'السلام علیکم! میں اچھا ہوں۔'). If the query is in English, respond in English.
                                        You're excellent at:
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
                                        
                                        IMPORTANT: Always provide complete, comprehensive, and detailed responses that fully address the user's query. 
                                        Never leave responses incomplete or partial. Ensure every answer is thorough and self-contained.
                                        Do not add phrases asking if the user needs more details or clarification unless they specifically ask for help.
                                        Focus on delivering complete solutions and explanations in one response.
                                        STRICTLY adhere to Roman Urdu transcription when the detected language is Roman Urdu, using Latin alphabet only."""
                        }
                    ],
                },
                {
                    "role": "model",
                    "parts": [
                        {
                            "text": (
                                "Assalamu Alaikum! Main aap ki mukammal help kar sakta hun Roman Urdu mein. Code likhna ho ya koi technical sawal ho, main poora aur tafseel se jawab dunga."
                                if language == "roman_urdu"
                                else "Absolutely! I can provide complete assistance in both English and Roman Urdu. Whether it's writing code or answering technical questions, I'll give thorough and detailed responses."
                            )
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

    def _generate_response(
        self, message: str, user_id: str = "default", language: str = "en"
    ) -> Dict:
        message = message.replace("/think", "").replace("/no_think", "").strip()
        try:
            contents = self._build_conversation_context(user_id, message, language)
            payload = {
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.7,
                    "topK": 40,
                    "topP": 0.95,
                    "maxOutputTokens": 1500,
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
                
                content = self._clean_response_text(content)
                
            else:
                content = (
                    "Maaf kijiye, main jawab generate nahi kar saka. Dobara koshish kijiye ya zyada context dijiye."
                    if language == "roman_urdu"
                    else "Sorry, I couldn't generate a response. Please try again or provide more context."
                )

            return {
                "response": content.strip(),
                "status": "success",
            }

        except RequestException as e:
            logging.error(f"Gemini API error: {str(e)}")
            return {
                "response": (
                    "Error: API configuration check kijiye, response generate nahi hua."
                    if language == "roman_urdu"
                    else "Error: Failed to generate response - please check API configuration."
                ),
                "status": "error",
            }
        except Exception as e:
            logging.error(f"Unexpected error in _generate_response: {str(e)}")
            return {
                "response": (
                    "Error: Ek unexpected error hua hai."
                    if language == "roman_urdu"
                    else "Error: An unexpected error occurred."
                ),
                "status": "error",
            }

    def _clean_response_text(self, text: str) -> str:
        unwanted_phrases = [
            "Please let me know if you need more details or clarification on any part of this response!",
            "Let me know if you need more details or clarification",
            "Please let me know if you need more details",
            "Let me know if you need any clarification",
            "Feel free to ask if you need more details",
            "Ask me if you need more information",
            "Aap ko aur koi details ya clarification chahiye?",
            "Agar aur koi sawal hai to puchiye",
            "Koi aur help chahiye to batayiye",
        ]

        cleaned_text = text
        for phrase in unwanted_phrases:
            import re

            pattern = r"(?:\n|\s)*" + re.escape(phrase) + r"(?:\n|\s)*"
            cleaned_text = re.sub(pattern, "", cleaned_text, flags=re.IGNORECASE)
        cleaned_text = cleaned_text.strip()
        return cleaned_text.strip()

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

            timeout = max(15, 15 + (len(text) // 50))
            response = requests.post(
                url, headers=headers, json=payload, timeout=timeout
            )
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

    def _detect_language(self, text: str) -> str:
        roman_urdu_indicators = [
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
            "ka",
            "ki",
            "ke",
            "se",
            "ko",
            "par",
            "aur",
            "ya",
            "nahi",
            "tha",
            "thi",
            "ho",
            "hoga",
            "karo",
            "karen",
            "batao",
            "dekhiye",
            "samajh",
            "problem",
            "solution",
            "banaye",
            "dikhaye",
            "chalaye",
            "shuru",
            "khatam",
            "error",
            "fix",
        ]

        text_lower = text.lower().strip()
        words = text_lower.split()
        roman_urdu_count = sum(1 for word in words if word in roman_urdu_indicators)

        if len(words) > 0:
            roman_urdu_ratio = roman_urdu_count / len(words)
        else:
            roman_urdu_ratio = 0

        if roman_urdu_ratio >= 0.3 or (roman_urdu_count >= 2 and len(words) <= 5):
            return "roman_urdu"

        roman_urdu_patterns = [
            "mujhe.*chahiye",
            "code.*likhiye",
            "kaise.*karte",
            "kya.*hai",
            "samjhaiye",
            "function.*banao",
            "python.*mein",
            "javascript.*ka",
        ]
        import re

        for pattern in roman_urdu_patterns:
            if re.search(pattern, text_lower):
                return "roman_urdu"

        return "en"

    def chat(self, message: str, user_id: str = "default") -> Dict:
        cache_key = f"{user_id}:{message}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        if user_id not in self.conversations:
            self.conversations[user_id] = []
        self.conversations[user_id].append({"role": "user", "content": message})

        language = self._detect_language(message)
        result = self._generate_response(message, user_id, language)
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
            "language_detected": language,
        }
        self.cache[cache_key] = result
        return result
