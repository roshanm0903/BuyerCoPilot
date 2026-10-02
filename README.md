# Run and deploy your AI Studio app

This contains everything you need to run your app locally.


## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Item master

The SQLite database in `data/procurement.sqlite` contains the `items` master. Migration 6 populates it from existing RFx and purchase request lines and links PR, RFx, and quote lines through `item_id`. The Database Visualizer opens on **Items (Item Master)**. `GET /api/items` lists the catalog, and `GET /api/items/:itemId/suppliers` finds approved supplier product mappings for one item. RFx line reads and the RFQ workbook use current item master descriptions and specifications.

Run `npm run db:migrate` after updating an existing local copy. The migration keeps existing procurement records and runs only once.
