# WebLLM Proof of Concept

This project is a proof of concept for a web-based language model (WebLLM) chat application. It consists of a frontend for the chat interface and a backend for handling embeddings and retrievals using Qdrant.

## Prerequisites

- [Bun.sh](https://bun.sh/)
- [Docker](https://www.docker.com/)

## Setup

1. **Clone the repository:**

  ```sh
  git clone https://github.com/your-repo/webllm.git
  cd webllm
  ```

2. **Install dependencies:**

  ```sh
  bun install
  ```

3. **Start Qdrant using Docker:**

  ```sh
  docker-compose up -d
  ```

4. **Start the backend:**

  ```sh
  cd backend
  bun start
  ```

5. **Start the frontend:**

  ```sh
  cd frontend
  bun start
  ```

6. **Embed the files:**

  ```sh
  cd embeds
  bun start
  ```

## Usage

- Open your browser and navigate to <http://localhost:8883> to access the chat interface.
- Use the chat interface to interact with the language model.

## API Endpoints

- **POST /embed:** Insert or update an embedding in Qdrant.
- **DELETE /embed/all:** Remove all embeddings from Qdrant.
- **DELETE /embed/:id:** Remove an embedding from Qdrant.
- **GET /retrieve:** Search for similar documents.
- **GET /list:** List stored embeddings with pagination.

## License

This project is licensed under the MIT License.
