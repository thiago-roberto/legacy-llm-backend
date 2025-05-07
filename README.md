# Legacy LLM Backend

This is the backend for the Legacy LLM POC, built with Express.js and LangChain, and integrated with pgvector for vector similarity search.

## 🧩 Features

- Embeds text data using OpenAI
- Stores embeddings in PostgreSQL with pgvector
- Supports Retrieval-Augmented Generation (RAG)
- REST API for `/ask` and `/search`

## 🛠 Tech Stack

- Node.js + Express
- TypeScript
- LangChain.js
- OpenAI API
- PostgreSQL + pgvector
- Deployed on Render

## 🧪 Environment Variables

Create a `.env` file in the root with:

```env
OPENAI_API_KEY=your-openai-key
DATABASE_URL=postgres://<user>:<pass>@<host>:<port>/<db>
```

## 🚀 Getting Started (Locally)

```bash
git clone https://github.com/thiago-roberto/legacy-llm-backend.git
cd legacy-llm-backend
npm install
npm run dev
```

## 🧠 Endpoints

- `POST /ask`: Uses RAG to return a completion based on similar documents
- `POST /search`: Returns similar document chunks from pgvector

## ⚙️ Build & Deploy (Render)

```bash
npm run build
npm run start
```

Ensure the `DATABASE_URL` and `OPENAI_API_KEY` are set in Render's environment variables.

## 🧹 Notes

- On every start, old data is truncated and top 400 relevant entries are inserted.
- CSV and JSON files are parsed from `/src/datasets/`.

## 🤝 Contributions

This project is for demonstration purposes.