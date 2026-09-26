# 07 - GraphQL Interfaces

> **Source Reference**: [NestJS Official Documentation - Interfaces](https://docs.nestjs.com/graphql/interfaces)

A GraphQL **interface** is an abstract type that defines a contract of fields that concrete object types must implement. When a field returns an interface type, queries can request common fields directly, or request type-specific fields using inline fragments (`... on ConcreteType`).

---

## 1. Code First Interfaces

In the code-first approach, define an interface as an abstract TypeScript class annotated with `@InterfaceType()`:

```typescript
import { Field, ID, InterfaceType } from '@nestjs/graphql';

@InterfaceType({ description: 'Base interface for game characters' })
export abstract class Character {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}
```

> [!WARNING]
> TypeScript `interface` constructs cannot be used to emit GraphQL interfaces because TypeScript interfaces are erased at compile time. You must use an abstract class.

---

## 2. Implementing the Interface

To implement an interface, use the `implements` property of `@ObjectType()`:

```typescript
import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Character } from './character.interface.js';

@ObjectType({
  implements: () => [Character],
  description: 'A human character with an age attribute',
})
export class Human implements Character {
  id: string;
  name: string;

  @Field(() => Int)
  age: number;
}

@ObjectType({
  implements: () => [Character],
  description: 'A droid character with an operational model string',
})
export class Droid implements Character {
  id: string;
  name: string;

  @Field()
  primaryFunction: string;
}
```

### Type Resolution (`resolveType`)

When an interface is returned by a query, the GraphQL engine must determine which concrete type is being returned:
- **Default Resolution**: Based on the prototype of the returned object. **Resolvers must return class instances** (e.g. `new Human()`), not plain object literals (`{ id: '1' }`).
- **Custom Resolution**: Provide a `resolveType` function in `@InterfaceType()`:

```typescript
@InterfaceType({
  resolveType(character: any) {
    if ('primaryFunction' in character) {
      return Droid;
    }
    return Human;
  },
})
export abstract class Character { ... }
```

---

## 3. Interface Resolvers & Resolver Inheritance

You can define shared field resolvers directly on the interface so that all implementing types inherit the field resolution automatically:

```typescript
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Character } from './character.interface.js';

@Resolver(() => Character)
export class CharacterInterfaceResolver {
  @ResolveField(() => [Character])
  async friends(@Parent() character: Character): Promise<Character[]> {
    // Shared resolution logic across Humans, Droids, etc.
    return [];
  }
}
```

Enable resolver inheritance in `GraphQLModule`:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true,
  // Required to inherit field resolvers from interface resolvers
  inheritResolversFromInterfaces: true,
}),
```
