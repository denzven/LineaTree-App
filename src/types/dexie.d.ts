declare module 'dexie' {
  export class Dexie {
    constructor(databaseName: string);
    version(versionNumber: number): {
      stores(schema: Record<string, string>): any;
    };
    transaction(mode: 'rw' | 'r', tables: any[], callback: () => Promise<any>): Promise<any>;
  }

  export interface Table<T, Key = string> {
    clear(): Promise<void>;
    bulkAdd(items: T[]): Promise<any>;
    add(item: T): Promise<any>;
    delete(key: Key): Promise<void>;
    update(key: Key, changes: Partial<T>): Promise<number>;
    toArray(): Promise<T[]>;
    put(item: T): Promise<Key>;
  }

  export default Dexie;
}

declare module 'dexie-react-hooks' {
  export function useLiveQuery<T>(
    querier: () => Promise<T> | T | undefined | null,
    deps?: any[],
    defaultValue?: T
  ): T;
}
