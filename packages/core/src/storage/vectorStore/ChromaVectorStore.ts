import {
  AddParams,
  ChromaClient,
  ChromaClientParams,
  Collection,
  Embeddings,
  IncludeEnum,
  QueryResponse,
  Where,
  WhereDocument,
} from "chromadb";
import { BaseNode, Document, MetadataMode } from "../../Node";
import {
  VectorStore,
  VectorStoreQuery,
  VectorStoreQueryMode,
  VectorStoreQueryResult,
} from "./types";
import { nodeToMetadata } from "./utils";

type ChromaDeleteOptions = {
  where?: Where;
  whereDocument?: WhereDocument;
};

type ChromaQueryOptions = {
  whereDocument?: WhereDocument;
};

export class ChromaVectorStore implements VectorStore {
  DEFAULT_TEXT_KEY = "text";
  storesText: boolean = true;
  flatMetadata: boolean = true;
  private chromaClient: ChromaClient;
  private collection: Collection | null = null;
  private collectionName: string;

  constructor(collectionName: string, chromaClientParams?: ChromaClientParams) {
    this.clearCollection();
    this.collectionName = collectionName;
    this.chromaClient = new ChromaClient(chromaClientParams);
  }

  client(): ChromaClient {
    return this.chromaClient;
  }

  // Singleton pattern to ensure we only create one collection
  async getCollection(): Promise<Collection> {
    if (!this.collection) {
      const coll = await this.chromaClient.createCollection({
        name: this.collectionName,
      });
      this.collection = coll;
    }
    return this.collection;
  }

  clearCollection(): void {
    this.collection = null;
  }

  private getDataToInsert(nodes: BaseNode[]): AddParams {
    const metadatas = nodes.map((node) =>
      nodeToMetadata(node, true, this.DEFAULT_TEXT_KEY, this.flatMetadata),
    );
    return {
      embeddings: nodes.map((node) => node.getEmbedding()),
      ids: nodes.map((node) => node.id_),
      metadatas,
      documents: nodes.map((node) => node.getContent(MetadataMode.NONE)),
    };
  }

  async add(nodes: BaseNode[]): Promise<string[]> {
    if (!nodes || nodes.length === 0) {
      return [];
    }

    const dataToInsert = this.getDataToInsert(nodes);
    const collection = await this.getCollection();
    await collection.add(dataToInsert);
    return nodes.map((node) => node.id_);
  }

  async delete(
    refDocId: string,
    deleteOptions?: ChromaDeleteOptions,
  ): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.delete({
        ids: [refDocId],
        where: deleteOptions?.where,
        whereDocument: deleteOptions?.whereDocument,
      });
      this.clearCollection();
    } catch (err) {
      const msg = `${err}`;
      console.log(msg, err);
      throw err;
    }
  }

  async query(
    query: VectorStoreQuery,
    options?: ChromaQueryOptions,
  ): Promise<VectorStoreQueryResult> {
    if (query.docIds) {
      throw new Error("ChromaDB does not support querying by docIDs");
    }
    if (query.mode != VectorStoreQueryMode.DEFAULT) {
      throw new Error("ChromaDB does not support querying by mode");
    }

    const chromaWhere: { [x: string]: string | number | boolean } = {};
    if (query.filters) {
      query.filters.filters.map((filter) => {
        const filterKey = filter.key;
        const filterValue = filter.value;
        chromaWhere[filterKey] = filterValue;
      });
    }
    try {
      const collection = await this.getCollection();
      const queryResponse: QueryResponse = await collection.query({
        queryEmbeddings: query.queryEmbedding ?? undefined,
        queryTexts: query.queryStr ?? undefined,
        nResults: query.similarityTopK,
        where: Object.keys(chromaWhere).length ? chromaWhere : undefined,
        whereDocument: options?.whereDocument,
        //ChromaDB doesn't return the result embeddings by default so we need to include them
        include: [
          IncludeEnum.Distances,
          IncludeEnum.Metadatas,
          IncludeEnum.Documents,
          IncludeEnum.Embeddings,
        ],
      });
      const vectorStoreQueryResult: VectorStoreQueryResult = {
        nodes: queryResponse.ids[0].map((id, index) => {
          return new Document({
            id_: id,
            text: (queryResponse.documents as string[][])[0][index],
            metadata: queryResponse.metadatas[0][index] ?? {},
            embedding: (queryResponse.embeddings as Embeddings[])[0][index],
          });
        }),
        similarities: (queryResponse.distances as number[][])[0].map(
          (distance) => 1 - distance,
        ),
        ids: queryResponse.ids[0],
      };
      return vectorStoreQueryResult;
    } catch (err) {
      const msg = `${err}`;
      console.log(msg, err);
      throw err;
    }
  }
}
