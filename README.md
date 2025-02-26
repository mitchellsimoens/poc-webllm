# WebLLM Proof of Concept

This project is a proof of concept for a web-based language model (WebLLM) chat application. It consists of a frontend for the chat interface and a backend for handling embeddings and retrievals using Qdrant.

## Prerequisites

- [Bun.sh](https://bun.sh/)
- [Docker](https://www.docker.com/)

## Setup

1. **Clone the repository:**

  ```sh
  git clone https://github.com/mitchellsimoens/poc-webllm.git
  cd poc-webllm
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

## Sample Prompts

> Return the quarterly profits for the year 2024

> Provide CSV for the yearly total sales and year-over-year growth rate by year for all sales data

> What was the sales for the first half of 2018?

## License

This project is licensed under the MIT License.
