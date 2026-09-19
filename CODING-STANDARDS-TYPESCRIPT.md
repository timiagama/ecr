# Rules for Generating Robust & Maintainable Code

## 1. Core Principles & Constraints


- **Environment:** Assume a strict TypeScript (`5.x+`) environment on Node.js (`20+`).
    
- **Quality Gates:** The code must pass strict TypeScript compilation and be free of SonarLint issues.
    
- **Core Goals:** Prioritize maintainability, Separation of Concerns (SoC), deep modules with simple interfaces, and robustness.
    
- **Dependencies:** Prefer using well-known, existing open-source packages over reinventing common functionality (e.g., use `zod` for validation, `date-fns` for date manipulation).
    

## 2. Code Style & Readability

### 2.1. Prioritize Readability Over Conciseness

**Rule:** Write code for human understanding. The flow of logic must be explicit.

- Use standard `if/else` statements for control flow. Avoid complex nested ternary operators.
    
- Use explicit block bodies and `return` statements for arrow functions unless the expression is a single token.
    
    - **Good:** `const add = (a, b) => { return a + b; };` or `items.map(item => item.id);`
        
    - **Bad:** `const complexCalc = (a, b) => a > 0 ? (a + b) / 2 : Math.abs(b);`
        

### 2.2. Use Explicit Typing for All Boundaries

**Rule:** All function parameters, return types, and public class properties must have explicit types. Any variable initialized with the result of a function call must also be explicitly typed.

- **Why:** This creates a strong contract. If a function's signature changes (e.g., from `boolean` to `Promise<boolean>`), the compiler will immediately catch the mismatch, preventing runtime bugs.
    
- **Exception:** Type inference is acceptable _only_ for variables initialized with static literals (e.g., `const name = "Alice";`, `const count = 10;`).
    

### 2.3. Embrace Immutability

**Rule:** Mark any data that should not be changed after initialization as `readonly`.

- This applies to class properties, object properties, arrays, and tuples. Use `readonly` for properties and `ReadonlyArray<T>` for arrays to prevent accidental mutations.
    

### 2.4. Use Named Types for Object Shapes

**Rule:** Do not define object shapes inline within function signatures. Always define a named `interface` or `type` alias for any non-trivial object structure and use the name as the type annotation.

- **Why:** Inline object types are not reusable and they clutter function signatures, making them difficult to read. Giving a data structure a name makes the code self-documenting and improves maintainability.
    
- **Bad:** `public getConfig(): { maxPoolSize: number; options: { retries: number } } { ... }`
    
- **Good:**
    
    ```
    interface CrawlerConfig {
      maxPoolSize: number;
      options: { retries: number };
    }
    
    public getConfig(): CrawlerConfig { ... }
    ```
    

## 3. Architecture & Design

### 3.1. Keep Functions Small and Focused

**Rule:** Each function must have a single, well-defined responsibility. Decompose complex logic into smaller, private helper functions.

### 3.2. Perform Input Validation

**Rule:** Functions should perform reasonable validation of their inputs at the beginning (guard clauses). This is for ensuring correct operation, not security.

### 3.3. Prefer Classes with Behavior

**Rule:** For projects not focused on web front-end tree-shaking, prefer stateful classes that encapsulate both data and behaviour over exporting collections of functions from modules.

### 3.4. Use Explicit Access Modifiers

**Rule:** All class properties and methods must have an explicit access modifier (`public`, `private`, or `protected`). Do not rely on TypeScript's default `public` behavior.

- **Why:** Explicitly stating visibility serves as clear documentation of the class's public API and its internal workings. It prevents accidental usage of internal-only members.
    

## 4. Documentation & Naming

### 4.1. Use Fully Descriptive Naming

**Rule:** Names must clearly communicate purpose. Avoid abbreviations or generic names like `data` or `result`. This means:

- Prefer **story verbs**: `show`, `prepare`, `explain`, `tell`
    
- Prefer **purpose nouns**: `constraints`, `context`, `connection`, `heading`, `label`
    
- Avoid infrastructure nouns as primary names (`registry`, `engine`, `store`) unless describing internals
    
- Avoid ambiguous graph jargon in core tools (`traverse`, `neighbors`, `closure`) — those can exist in debug tools


**Bad:** `let res = isValid(d);`
    
**Good:** `const isApiResponseValid: boolean = validateUserPayload(apiResponseData);`
    

### 4.2. Document Everything with TSDoc

**Rule:** Every exported class, function, and method (including private ones) must have a TSDoc block.

- **Functions/Methods:** Document the purpose, all arguments (`@param`), return values (`@returns`), and any potential exceptions (`@throws`).
    
- **Classes:** Provide a description and, where helpful, a usage example (`@example`).