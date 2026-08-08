---
description: Learn how to generate text and have conversations with Groq&#x27;s Chat Completions API, including streaming, JSON mode, and advanced features.
title: Text Generation - GroqDocs
image: https://console.groq.com/og_cloudv5.jpg
---

# Text Generation

Generating text with Groq's Chat Completions API enables you to have natural, conversational interactions with Groq's large language models. It processes a series of messages and generates human-like responses that can be used for various applications including conversational agents, content generation, task automation, and generating structured data outputs like JSON for your applications.

## [Chat Completions](#chat-completions)

Chat completions allow your applications to have dynamic interactions with Groq's models. You can send messages that include user inputs and system instructions, and receive responses that match the conversational context.

  
Chat models can handle both multi-turn discussions (conversations with multiple back-and-forth exchanges) and single-turn tasks where you need just one response.

  
For details about all available parameters, [visit the API reference page.](https://console.groq.com/docs/api-reference#chat-create)

### [Getting Started with Groq SDK](#getting-started-with-groq-sdk)

To start using Groq's Chat Completions API, you'll need to install the [Groq SDK](https://console.groq.com/docs/libraries) and set up your [API key](https://console.groq.com/keys).

PythonJavaScript

shell

```
pip install groq
```

## [Performing a Basic Chat Completion](#performing-a-basic-chat-completion)

The simplest way to use the Chat Completions API is to send a list of messages and receive a single response. Messages are provided in chronological order, with each message containing a role ("system", "user", or "assistant") and content.

Python

```
from groq import Groq

client = Groq()

chat_completion = client.chat.completions.create(
    messages=[
        # Set an optional system message. This sets the behavior of the
        # assistant and can be used to provide specific instructions for
        # how it should behave throughout the conversation.
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        # Set a user message for the assistant to respond to.
        {
            "role": "user",
            "content": "Explain the importance of fast language models",
        }
    ],

    # The language model which will generate the completion.
    model="llama-3.3-70b-versatile"
)

# Print the completion returned by the LLM.
print(chat_completion.choices[0].message.content)
```

## [Streaming a Chat Completion](#streaming-a-chat-completion)

For a more responsive user experience, you can stream the model's response in real-time. This allows your application to display the response as it's being generated, rather than waiting for the complete response.

To enable streaming, set the parameter `stream=True`. The completion function will then return an iterator of completion deltas rather than a single, full completion.

Python

```
from groq import Groq

client = Groq()

stream = client.chat.completions.create(
    #
    # Required parameters
    #
    messages=[
        # Set an optional system message. This sets the behavior of the
        # assistant and can be used to provide specific instructions for
        # how it should behave throughout the conversation.
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        # Set a user message for the assistant to respond to.
        {
            "role": "user",
            "content": "Explain the importance of fast language models",
        }
    ],

    # The language model which will generate the completion.
    model="llama-3.3-70b-versatile",

    #
    # Optional parameters
    #

    # Controls randomness: lowering results in less random completions.
    # As the temperature approaches zero, the model will become deterministic
    # and repetitive.
    temperature=0.5,

    # The maximum number of tokens to generate. Requests can use up to
    # 2048 tokens shared between prompt and completion.
    max_completion_tokens=1024,

    # Controls diversity via nucleus sampling: 0.5 means half of all
    # likelihood-weighted options are considered.
    top_p=1,

    # A stop sequence is a predefined or user-specified text string that
    # signals an AI to stop generating content, ensuring its responses
    # remain focused and concise. Examples include punctuation marks and
    # markers like "[end]".
    stop=None,

    # If set, partial message deltas will be sent.
    stream=True,
)

# Print the incremental deltas returned by the LLM.
for chunk in stream:
    print(chunk.choices[0].delta.content, end="")
```

## [Performing a Chat Completion with a Stop Sequence](#performing-a-chat-completion-with-a-stop-sequence)

Stop sequences allow you to control where the model should stop generating. When the model encounters any of the specified stop sequences, it will halt generation at that point. This is useful when you need responses to end at specific points.

Python

```
from groq import Groq

client = Groq()

chat_completion = client.chat.completions.create(
    #
    # Required parameters
    #
    messages=[
        # Set an optional system message. This sets the behavior of the
        # assistant and can be used to provide specific instructions for
        # how it should behave throughout the conversation.
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        # Set a user message for the assistant to respond to.
        {
            "role": "user",
            "content": "Count to 10.  Your response must begin with \"1, \".  example: 1, 2, 3, ...",
        }
    ],

    # The language model which will generate the completion.
    model="llama-3.3-70b-versatile",

    #
    # Optional parameters
    #

    # Controls randomness: lowering results in less random completions.
    # As the temperature approaches zero, the model will become deterministic
    # and repetitive.
    temperature=0.5,

    # The maximum number of tokens to generate. Requests can use up to
    # 2048 tokens shared between prompt and completion.
    max_completion_tokens=1024,

    # Controls diversity via nucleus sampling: 0.5 means half of all
    # likelihood-weighted options are considered.
    top_p=1,

    # A stop sequence is a predefined or user-specified text string that
    # signals an AI to stop generating content, ensuring its responses
    # remain focused and concise. Examples include punctuation marks and
    # markers like "[end]".
    # For this example, we will use ", 6" so that the llm stops counting at 5.
    # If multiple stop values are needed, an array of string may be passed,
    # stop=[", 6", ", six", ", Six"]
    stop=", 6",

    # If set, partial message deltas will be sent.
    stream=False,
)

# Print the completion returned by the LLM.
print(chat_completion.choices[0].message.content)
```

## [Performing an Async Chat Completion](#performing-an-async-chat-completion)

For applications that need to maintain responsiveness while waiting for completions, you can use the asynchronous client. This lets you make non-blocking API calls using Python's asyncio framework.

Python

```
import asyncio

from groq import AsyncGroq


async def main():
    client = AsyncGroq()

    chat_completion = await client.chat.completions.create(
        #
        # Required parameters
        #
        messages=[
            # Set an optional system message. This sets the behavior of the
            # assistant and can be used to provide specific instructions for
            # how it should behave throughout the conversation.
            {
                "role": "system",
                "content": "You are a helpful assistant."
            },
            # Set a user message for the assistant to respond to.
            {
                "role": "user",
                "content": "Explain the importance of fast language models",
            }
        ],

        # The language model which will generate the completion.
        model="llama-3.3-70b-versatile",

        #
        # Optional parameters
        #

        # Controls randomness: lowering results in less random completions.
        # As the temperature approaches zero, the model will become
        # deterministic and repetitive.
        temperature=0.5,

        # The maximum number of tokens to generate. Requests can use up to
        # 2048 tokens shared between prompt and completion.
        max_completion_tokens=1024,

        # Controls diversity via nucleus sampling: 0.5 means half of all
        # likelihood-weighted options are considered.
        top_p=1,

        # A stop sequence is a predefined or user-specified text string that
        # signals an AI to stop generating content, ensuring its responses
        # remain focused and concise. Examples include punctuation marks and
        # markers like "[end]".
        stop=None,

        # If set, partial message deltas will be sent.
        stream=False,
    )

    # Print the completion returned by the LLM.
    print(chat_completion.choices[0].message.content)

asyncio.run(main())
```

### [Streaming an Async Chat Completion](#streaming-an-async-chat-completion)

You can combine the benefits of streaming and asynchronous processing by streaming completions asynchronously. This is particularly useful for applications that need to handle multiple concurrent conversations.

Python

```
import asyncio

from groq import AsyncGroq


async def main():
    client = AsyncGroq()

    stream = await client.chat.completions.create(
        #
        # Required parameters
        #
        messages=[
            # Set an optional system message. This sets the behavior of the
            # assistant and can be used to provide specific instructions for
            # how it should behave throughout the conversation.
            {
                "role": "system",
                "content": "You are a helpful assistant."
            },
            # Set a user message for the assistant to respond to.
            {
                "role": "user",
                "content": "Explain the importance of fast language models",
            }
        ],

        # The language model which will generate the completion.
        model="llama-3.3-70b-versatile",

        #
        # Optional parameters
        #

        # Controls randomness: lowering results in less random completions.
        # As the temperature approaches zero, the model will become
        # deterministic and repetitive.
        temperature=0.5,

        # The maximum number of tokens to generate. Requests can use up to
        # 2048 tokens shared between prompt and completion.
        max_completion_tokens=1024,

        # Controls diversity via nucleus sampling: 0.5 means half of all
        # likelihood-weighted options are considered.
        top_p=1,

        # A stop sequence is a predefined or user-specified text string that
        # signals an AI to stop generating content, ensuring its responses
        # remain focused and concise. Examples include punctuation marks and
        # markers like "[end]".
        stop=None,

        # If set, partial message deltas will be sent.
        stream=True,
    )

    # Print the incremental deltas returned by the LLM.
    async for chunk in stream:
        print(chunk.choices[0].delta.content, end="")

asyncio.run(main())
```

## [Structured Outputs and JSON](#structured-outputs-and-json)

Need reliable, type-safe JSON responses that match your exact schema? Groq's Structured Outputs feature is designed so that model responses strictly conform to your JSON Schema without validation or retry logic.

  
For complete guides on implementing structured outputs with JSON Schema or using JSON Object Mode, see our [structured outputs documentation](https://console.groq.com/docs/structured-outputs).

  
Key capabilities:

* **JSON Schema enforcement**: Responses match your schema exactly
* **Type-safe outputs**: No validation or retry logic needed
* **Programmatic refusal detection**: Handle safety-based refusals programmatically
* **JSON Object Mode**: Basic JSON output with prompt-guided structure



---
description: Generate expressive speech audio from text using Orpheus v1 models with vocal directions support - available in English and Arabic Saudi dialect.
title: Orpheus Text to Speech - GroqDocs
image: https://console.groq.com/og_cloudv5.jpg
---

# Orpheus Text to Speech

Generate expressive, natural-sounding speech with vocal direction controls for dynamic audio output.

## [Overview](#overview)

Orpheus text-to-speech models by [Canopy Labs](https://canopylabs.ai/) provide fast, high-quality audio generation with unique expressive capabilities. Both models offer multiple voices and low-latency inference, with the English model supporting [vocal direction controls](#vocal-directions) for expressive performances.

## [Supported Models](#supported-models)

Groq hosts two specialized Orpheus models for different language needs:

| Model ID                                                                       | Description                                   | Language       | Vocal Directions |
| ------------------------------------------------------------------------------ | --------------------------------------------- | -------------- | ---------------- |
| [canopylabs/orpheus-v1-english](https://console.groq.com/docs/model/canopylabs/orpheus-v1-english)     | Expressive English TTS with direction support | English        | ✅ Supported      |
| [canopylabs/orpheus-arabic-saudi](https://console.groq.com/docs/model/canopylabs/orpheus-arabic-saudi) | Authentic Saudi dialect synthesis             | Arabic (Saudi) | ❌ Not Supported  |

## [Pricing](#pricing)

| Model ID                        | Price                      |
| ------------------------------- | -------------------------- |
| canopylabs/orpheus-v1-english   | $22 / 1 million characters |
| canopylabs/orpheus-arabic-saudi | $40 / 1 million characters |

## [API Endpoint](#api-endpoint)

| Endpoint | Usage                 | API Endpoint                                |
| -------- | --------------------- | ------------------------------------------- |
| Speech   | Convert text to audio | https://api.groq.com/openai/v1/audio/speech |

## [Quick Start](#quick-start)

The speech endpoint accepts these parameters:

| Parameter        | Type   | Required | Description                                                                                                |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| model            | string | Yes      | Model ID: canopylabs/orpheus-v1-english or canopylabs/orpheus-arabic-saudi                                 |
| input            | string | Yes      | Text to convert to speech (max 200 characters). Use \[directions\] for [vocal control](#vocal-directions). |
| voice            | string | Yes      | Voice persona ID to use (see [Available Voices](#available-voices))                                        |
| response\_format | string | Optional | Audio format. Defaults to "wav". The only supported format is "wav".                                       |

## [Basic Usage](#basic-usage)

EnglishArabic Saudi Dialect

### [English Model](#english-model)

Python

```
# Install the Groq SDK:
# pip install groq

# English Model Example:
import os
from groq import Groq

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

speech_file_path = "orpheus-english.wav" 
model = "canopylabs/orpheus-v1-english"
voice = "troy"
text = "Welcome to Orpheus text-to-speech. [cheerful] This is an example of high-quality English audio generation with vocal directions support."
response_format = "wav"

response = client.audio.speech.create(
    model=model,
    voice=voice,
    input=text,
    response_format=response_format
)

response.write_to_file(speech_file_path)
```

```
// Install the Groq SDK:
// npm install --save groq-sdk

// English Model Example:
import fs from "fs";
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const speechFilePath = "orpheus-english.wav";
const model = "canopylabs/orpheus-v1-english";
const voice = "hannah";
const text = "Welcome to Orpheus text-to-speech. [cheerful] This is an example of high-quality English audio generation with vocal directions support.";
const responseFormat = "wav";

async function main() {
  const response = await groq.audio.speech.create({
    model: model,
    voice: voice,
    input: text,
    response_format: responseFormat
  });
  
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(speechFilePath, buffer);
  
  console.log(`Orpheus English speech generated: ${speechFilePath}`);
}

main().catch((error) => {
  console.error('Error generating speech:', error);
});
```

```
curl https://api.groq.com/openai/v1/audio/speech \
  -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopylabs/orpheus-v1-english",
    "input": "Welcome to Orpheus text-to-speech. [cheerful] This is an example of high-quality English audio generation with vocal directions support.",
    "voice": "austin",
    "response_format": "wav"
  }' \
  --output orpheus-english.wav
```

### [Arabic Saudi Dialect Model](#arabic-saudi-dialect-model)

Python

```
import os
from groq import Groq

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

speech_file_path = "orpheus-arabic.wav" 
model = "canopylabs/orpheus-arabic-saudi"
voice = "fahad"
text = "مرحبا بكم في نموذج أورفيوس للتحويل من النص إلى الكلام. هذا مثال على جودة الصوت العربية السعودية الطبيعية."
response_format = "wav"

response = client.audio.speech.create(
    model=model,
    voice=voice,
    input=text,
    response_format=response_format
)

response.write_to_file(speech_file_path)
```

```
import fs from "fs";
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const speechFilePath = "orpheus-arabic.wav";
const model = "canopylabs/orpheus-arabic-saudi";
const voice = "lulwa";
const text = "مرحبا بكم في نموذج أورفيوس للتحويل من النص إلى الكلام. هذا مثال على جودة الصوت العربية السعودية الطبيعية.";
const responseFormat = "wav";

async function main() {
  const response = await groq.audio.speech.create({
    model: model,
    voice: voice,
    input: text,
    response_format: responseFormat
  });
  
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(speechFilePath, buffer);
  
  console.log(`Orpheus Arabic speech generated: ${speechFilePath}`);
}

main().catch((error) => {
  console.error('Error generating Arabic speech:', error);
});
```

```
curl https://api.groq.com/openai/v1/audio/speech \
  -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopylabs/orpheus-arabic-saudi",
    "input": "مرحبا بكم في نموذج أورفيوس للتحويل من النص إلى الكلام. هذا مثال على جودة الصوت العربية السعودية الطبيعية.",
    "voice": "noura",
    "response_format": "wav"
  }' \
  --output orpheus-arabic.wav
```

## [Vocal Directions](#vocal-directions)

Orpheus V1 English supports **vocal directions** using bracketed text like `[cheerful]` or `[whisper]` to control how the model speaks. This powerful feature enables everything from subtle conversational nuances to highly expressive character performances.

### [How Directions Work](#how-directions-work)

* **More directions** \= more expressive, acted performance
* **Fewer/no directions** \= natural, casual conversational cadence
* Use 1-2 word directions (typically adjectives or adverbs)
  
**Common use cases:**

* **Customer support**: Use no directions for natural, friendly conversations
* **Game characters**: Add expressive directions for dynamic, performative speech
* **Professional narration**: Use `[professionally]` or `[authoritatively]` for business content
* **Storytelling**: Combine multiple directions to create engaging narrative performances

### [Direction Examples](#direction-examples)

**Conversational tones:**

* `[cheerful]`, `[friendly]`, `[casual]`, `[warm]`

**Professional styles:**

* `[professionally]`, `[authoritatively]`, `[formally]`, `[confidently]`

**Expressive performance:**

* `[whisper]`, `[excited]`, `[dramatic]`, `[deadpan]`, `[sarcastic]`

**Vocal qualities:**

* `[gravelly whisper]`, `[rapid babbling]`, `[singsong]`, `[breathy]`

**Note:** There isn't an official or exhaustive list of directions; the model recognizes many natural descriptors and ignores vague or unfamiliar ones.

## [Using Vocal Directions](#using-vocal-directions)

Natural ConversationExpressive PerformanceCombining Directions

### [Natural Conversation (No Directions)](#natural-conversation-no-directions)

For customer support, AI assistants, or natural dialogue, omit directions entirely. The model defaults to conversational, human-like cadence.

* **Example (Troy):** _"I see you ordered the Bose QuietComfort Ultra earbuds, order number 7829-XK-441, tracking ID H3J7L9C2F5V8, and yeah it looks like it's been stuck in transit since, uhh, Thursday the 8th."_
* **Example (Autumn):** _"Okay so I'm looking at your account here and it shows you've got the Dell XPS 15 9530, is that right? Let me just pull up the warranty info real quick... yep that all looks good!"_

**Tip:** Pure numbers like `203` are normalized to "two hundred and three." Use hyphens (`2-0-3`) for letter-by-letter reading.

### [Expressive Performance (With Directions)](#expressive-performance-with-directions)

Add bracketed directions for more dynamic, acted performances. Great for storytelling, game characters, or engaging content.

* _"**\[cheerful singsong\]** Good morning, everyone, and welcome to another beautiful day! **\[dropping tone\]** Now, let's talk about the budget cuts happening next month."_
* _"She picked up the phone and immediately started **\[rapid babbling\]** oh my god you won't believe what just happened I have to tell you everything right now."_
* _"**\[gravelly whisper\]** Legend has it that anyone who enters those woods after dark never comes back quite the same as they were before."_
* _"**\[piercing shout\]** Will someone please answer that phone it has been ringing nonstop **\[exasperated sigh\]** for the last twenty minutes straight!"_
* _"**\[mock sympathy\]** Oh no how terrible that must be for you **\[deadpan\]** anyway let me tell you about my actual problems this week."_

### [Combining Directions](#combining-directions)

You can use multiple directions in a single sentence to create dynamic performances:

* _"**\[building intensity\]** And then the car started making this noise, and the smoke was everywhere, and— **\[crescendo\]** the whole engine just exploded right there!"_
* _"**\[slurring slightly\]** I probably shouldn't have had that last glass of wine, but honestly— **\[giggling\]** this party is way more fun than I expected!"_
* _"The auctioneer rattled off **\[fast paced\]** fifty do I hear fifty-five fifty-five now sixty sixty going once going twice sold to the woman in red!"_

## [Available Voices](#available-voices)

### [English Voices](#english-voices)

The English model includes six professionally-trained voice personas. Each voice has different strengths for expressive direction performance.

| Voice Name | Voice ID | Gender |
| ---------- | -------- | ------ |
| Autumn     | autumn   | Female |
| Diana      | diana    | Female |
| Hannah     | hannah   | Female |
| Austin     | austin   | Male   |
| Daniel     | daniel   | Male   |
| Troy       | troy     | Male   |

  
**Note:** Some voices perform better with expressive directions than others. Experiment to find the voice that works best for your use case.

AutumnDianaHannahAustinDanielTroy

Autumn

0:000:00

Diana

0:000:00

Hannah

0:000:00

Austin

0:000:00

Daniel

0:000:00

Troy

0:000:00

### [Arabic Saudi Dialect Voices](#arabic-saudi-dialect-voices)

The Arabic model offers six distinct Saudi dialect voices with authentic pronunciation and regional nuances:

| Voice Name | Voice ID | Gender |
| ---------- | -------- | ------ |
| Abdullah   | abdullah | Male   |
| Fahad      | fahad    | Male   |
| Sultan     | sultan   | Male   |
| Lulwa      | lulwa    | Female |
| Noura      | noura    | Female |
| Aisha      | aisha    | Female |

AbdullahFahadSultanLulwaNouraAisha

Abdullah

0:000:00

Fahad

0:000:00

Sultan

0:000:00

Lulwa

0:000:00

Noura

0:000:00

Aisha

0:000:00

## [Use Cases](#use-cases)

Customer SupportGame CharactersProfessional NarrationContent Creation

### [Customer Support & AI Assistants](#customer-support--ai-assistants)

Use **no directions** for natural, conversational interactions that feel human and approachable.

* _"I'm looking at your account here and everything seems to be in order. Let me just check that shipping status for you real quick."_

**Best for:** Customer service bots, virtual assistants, FAQ systems

### [Game Characters & Interactive Media](#game-characters--interactive-media)

Use **expressive directions** to create memorable, dynamic character performances.

* _"**\[menacing whisper\]** You shouldn't have come here... **\[dark chuckle\]** but now that you have, let's see what you're made of."_

**Best for:** Video games, interactive storytelling, virtual worlds

### [Professional Narration & Business Content](#professional-narration--business-content)

Use **subtle professional directions** for authoritative, polished delivery.

* _"**\[professionally\]** Welcome to our quarterly earnings call. Today we'll review our performance and outline strategic initiatives for the coming quarter."_

**Best for:** Corporate videos, e-learning, business presentations

### [Content Creation & Entertainment](#content-creation--entertainment)

Combine **multiple directions** for engaging, varied performances.

* _"**\[excited\]** So you won't believe what happened next! **\[building suspense\]** The door slowly creaked open and— **\[dramatic gasp\]** there it was!"_

**Best for:** Podcasts, audiobooks, YouTube content, storytelling

## [Best Practices](#best-practices)

**Punctuation control:** Experiment with removing punctuation to give the model more freedom in choosing intonation patterns, especially for expressive performances.

**Voice selection:** Test different voices for your use case; some handle expressive directions better than others, particularly for complex emotional ranges.

**Arabic considerations:** Use proper Arabic script with diacritical marks. Test pronunciation with sample content before production deployment.

## [Limitations](#limitations)

**Input length:** The input text length is limited to 200 characters.

**Batch processing:** The [batch processing API](https://console.groq.com/docs/batch) is not supported at this time for Orpheus models.