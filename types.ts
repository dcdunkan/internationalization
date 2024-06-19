// Simply generating in the final formatting would be much easier than this.
// But I got carried away with the types, it's the first time I'm doing something
// that feels a little bit 'advanced' typescript!
//
import { FluentVariable } from "npm:@fluent/bundle@0.18.0";

type KeyOf<T> = string & keyof T;
type StringWithSuggestions<S extends string> =
    | string & Record<never, never>
    | S;

export const TYPES = {
    message: {
        variables: ["main1"],
        attrs: {
            key1: ["value1", "value2"],
            key2: ["value3", "value4"],
        },
    },
    message2: {
        variables: undefined,
        attrs: {
            key3: ["value5"],
            key4: undefined,
        },
    },
} as const;

type T = typeof TYPES;
type Message = KeyOf<T>;
type Attr<M extends Message = Message> = M extends unknown
    ? `${M}.${KeyOf<T[M]["attrs"]>}`
    : never;
type Key = Message | Attr;

type SplitKey<S extends Key> = S extends Message ? [S, undefined]
    : S extends "" ? [undefined, undefined]
    : S extends Attr ? S extends `${infer T}.${infer U}` ? [T, U] : never
    : [S, undefined];

type Variables<V> = V extends ReadonlyArray<string>
    ? { [key in V[number]]: FluentVariable }
    : undefined;

type Properties<S extends Key> = SplitKey<S>[0] extends Message
    ? SplitKey<S>[1] extends KeyOf<T[SplitKey<S>[0]]["attrs"]>
        ? Variables<T[SplitKey<S>[0]]["attrs"][SplitKey<S>[1]]>
    : Variables<T[SplitKey<S>[0]]["variables"]>
    : undefined;

export function translate<K extends Key>(key: K, variables?: Properties<K>) {
    return { key, variables };
}

function find(str: string | undefined) {
}

translate("message2.key4");
