// ============================================================================
// core/autosave.ts — revision-aware serialization for durable project saves.
//
// Project JSON is necessarily rebuilt after a real edit, but UI polling and
// multiple save destinations must reuse the same canonical string. This cache
// makes serialization proportional to edits rather than autosave timer ticks.
// ============================================================================

export type SerializedRevision = {
  json: string;
  revision: number;
  reused: boolean;
};

export class AutosaveSerializationCache<T> {
  private revision = 0;
  private serializedRevision = -1;
  private json = "";

  constructor(private readonly serialize: (value: T) => string) {}

  markChanged(): number {
    this.revision += 1;
    return this.revision;
  }

  reset(value: T, serialized?: string): SerializedRevision {
    this.revision = 0;
    this.serializedRevision = 0;
    this.json = serialized ?? this.serialize(value);
    return { json: this.json, revision: this.revision, reused: serialized !== undefined };
  }

  snapshot(value: T): SerializedRevision {
    if (this.serializedRevision === this.revision) {
      return { json: this.json, revision: this.revision, reused: true };
    }
    this.json = this.serialize(value);
    this.serializedRevision = this.revision;
    return { json: this.json, revision: this.revision, reused: false };
  }

  currentRevision(): number {
    return this.revision;
  }
}
