# Architecting Compounded Knowledge: Beyond Transient RAG with LLM WikiZZ

## The "Transient Knowledge" Problem
Most current interactions with Large Language Models (LLMs) and documents are **transient**. Whether you are using a standard ChatGPT file upload or a sophisticated RAG (Retrieval-Augmented Generation) system, the knowledge is rediscovered from scratch for every single query. There is no accumulation, no compounding of understanding, and no persistent "frame" through which the data is viewed. 

As Andrej Karpathy noted in his **LLM-Wiki** manifesto, the core limitation of modern RAG is that the LLM is constantly "rediscovering knowledge from scratch... nothing is built up."

## What is LLM WikiZZ?
**LLM WikiZZ** is an experimental extension of the LLM-Wiki philosophy. While the original concept focuses on a growing markdown-based knowledge base, LLM WikiZZ focuses on the **Discovery and Framing** phase. 

It asks a fundamental question: *If the LLM is the architect, why are we manually building the scaffolding?*

### The 5W1H Framework
Instead of just asking a question, WikiZZ forces the LLM to first define a **Wiki Frame** based on the 5W1H methodology:
1.  **Who**: Who is the audience or persona?
2.  **What**: What is the ultimate objective?
3.  **When**: What are the timing constraints?
4.  **Where**: What is the situational context?
5.  **Why**: Why does this answer matter?
6.  **How**: How should the knowledge be structured?

## How WikiZZ Extends the "Wiki" Concept

### 1. Autonomous Scaffolding (The Discovery Phase)
In the original Karpathy concept, a human might guide the ingestion. LLM WikiZZ implements an **Autonomous Discovery Phase**. By clicking "Generate Wiki", the LLM analyzes the document's DNA and automatically populates the 5W1H frame. This removes the "clerical grunt work" and ensures that every subsequent query is viewed through a consistent, professionally-curated lens.

### 2. Side-by-Side Validation (The Contrast Engine)
One of the hardest things in Prompt Engineering is proving that a "better" prompt actually produced a better result. WikiZZ includes a twin-engine execution model:
*   **Plain Mode**: Standard, un-framed RAG.
*   **WikiZZ Mode**: Framing the query through the synthesized 5W1H Wiki context.

Users can see, in real-time, how the context framing adds technical specificity and logical organization that plain queries often miss.

### 3. The "Judge" Architecture
WikiZZ doesn't just show you two answers; it uses a high-intelligence **Evaluator LLM** to compare them. It identifies semantic improvements, flagging exactly *what* changed—whether it's increased specificity, better concision, or improved situational awareness.

## Technical Architecture
*   **Zero-Server/Static-First**: The application runs entirely in the browser using `FileReader` for document parsing. It prioritizes privacy; your data never stays on a server.
*   **Secure CORS Proxy**: It leverages a Cloudflare Worker proxy (the same pattern used in the `QuantumStudio` project) to securely route API requests to providers like **NVIDIA NIM, Anthropic, OpenAI, and Google Gemini**. 
*   **Compounded Meta-Data**: The 5W1H context is stored in the session, allowing it to compound its value over multiple questions.

## Conclusion: The Future of Curation
The goal of LLM WikiZZ is to move the human from "Translator" to "Architect." By letting the LLM build the Wiki framing, we allow the system to reach into the deeper intent of the document. As we move toward more complex agentic workflows, the **Discovery Phase** seen in WikiZZ will become the standard for how we interact with all unstructured data.

---
*Authored by Vishal Mysore and the Antigravity AI Team.*
