import type { JsonObject, JsonValue } from "./types.js";

type RequiredPropertyNames<TSchema, TProperties> = TSchema extends {
  readonly required: readonly (infer TName)[];
}
  ? Extract<TName, keyof TProperties>
  : never;

type ObjectFromProperties<
  TSchema,
  TProperties extends Record<string, unknown>,
> = {
  readonly [
    TName in RequiredPropertyNames<TSchema, TProperties>
  ]-?: InferJsonSchema<TProperties[TName]>;
} & {
  readonly [
    TName in Exclude<
      keyof TProperties,
      RequiredPropertyNames<TSchema, TProperties>
    >
  ]?: InferJsonSchema<TProperties[TName]>;
};

type InferObjectSchema<TSchema> = TSchema extends {
  readonly properties: infer TProperties extends Record<string, unknown>;
}
  ? ObjectFromProperties<TSchema, TProperties>
  : JsonObject;

/**
 * Infers common JSON Schema shapes while falling back to JsonValue for advanced
 * constructs. Runtime schema validation remains authoritative.
 */
export type InferJsonSchema<TSchema> = TSchema extends {
  readonly const: infer TValue extends JsonValue;
}
  ? TValue
  : TSchema extends {
        readonly enum: readonly (infer TValue extends JsonValue)[];
      }
    ? TValue
    : TSchema extends { readonly type: "string" }
      ? string
      : TSchema extends { readonly type: "integer" | "number" }
        ? number
        : TSchema extends { readonly type: "boolean" }
          ? boolean
          : TSchema extends { readonly type: "null" }
            ? null
            : TSchema extends {
                  readonly type: "array";
                  readonly items: infer TItems;
                }
              ? readonly InferJsonSchema<TItems>[]
              : TSchema extends { readonly type: "object" }
                ? InferObjectSchema<TSchema>
                : JsonValue;

export type InferPackInput<TSchema> =
  InferJsonSchema<TSchema> extends infer TValue
    ? TValue extends JsonObject
      ? TValue
      : JsonObject
    : JsonObject;

export type InferPackOutput<TSchema> =
  InferJsonSchema<TSchema> extends infer TValue
    ? TValue extends JsonValue
      ? TValue
      : JsonValue
    : JsonValue;
