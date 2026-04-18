# LLM WikiZZ: Teaching LLMs to Frame Before They Answer

## The "Transient Knowledge" Paradox
When you upload a document to a Large Language Model (LLM), you are usually trapped in a cycle of transient RAG. The system rediscovers the document from scratch for every query, neglecting the "Context Debt" that builds up when an LLM doesn't truly understand the fundamental frame of the data. 

**LLM WikiZZ** is an open-source tool designed to break this cycle. Inspired by Andrej Karpathy's vision of a compounding "LLM-Wiki," it forces an autonomous **Discovery Phase** before a single question is answered. It teaches the LLM to architect its own scaffolding before it starts building the response.

## What is LLM WikiZZ?
WikiZZ is an experimental logic layer that sits between the user and the LLM. Instead of direct prompting, it implements a structured **5W1H Wiki Frame**:

1.  **Who**: The target audience/persona context.
2.  **What**: The core mission objective.
3.  **When**: The temporal and urgency context.
4.  **Where**: The situational and environmental context.
5.  **Why**: The underlying motivation/value.
6.  **How**: The structural and formatting requirement.

## How WikiZZ Transforms the "Wiki" Workflow

### 1. Autonomous Scaffolding
In traditional workflows, the user is the "Clerk," manually specifying the context for every query. In WikiZZ, the LLM becomes the "Architect." By clicking "Generate Wiki," the LLM analyzes the entire document and autonomously populates the 5W1H frame. This turns raw data into a persistent, shared mental model between the human and the machine.

### 2. The Contrast Engine
One of the hardest parts of evaluating AI performance is seeing the "value-add" of context. WikiZZ runs a side-by-side comparison:
*   **Plain Mode**: Standard, context-less RAG.
*   **WikiZZ Mode**: The query refined through the persistent 5W1H window.

Users can see exactly how the framing adds technical specificity and logical organization that plain queries often hallucinate away.

### 3. The LLM Jury
The system includes a high-intelligence **Evaluator LLM** that acts as a judge. It semantically analyzes the delta between the two answers, identifying specifically what improved—whether it was situational relevance, concision, or technical depth.

## Technical Architecture
*   **Zero-Server/Static-First**: The app runs entirely in your browser. Privacy is prioritized; your documents are parsed locally via `FileReader` and never stored.
*   **Secure CORS Proxying**: It leverages a secure Cloudflare Worker to route API requests to high-performance providers like **NVIDIA NIM, Anthropic, and Gemini**.
*   **Persistent Context**: Once generated, the WikiZZ Frame persists for the session, compounding its value over multiple queries.

## Conclusion: Turning Translators into Architects
LLM WikiZZ proves that the most valuable thing an LLM can do isn't answering the question—it's **understanding the request**. 

Consider a technical document on global warming: A "Plain" query might give you a standard list of environmental impacts. But with **WikiZZ Framing**, the LLM recognizes its "Why" and "What" as providing a technical guide for policymakers. Suddenly, that simple list is restructured into a mapped directory of chemical emissions—all without the user asking for that extra depth. 

This is the shift from a machine that translates to a machine that architectures.

---
*Authored by Vishal Mysore and the Antigravity AI Team.*
