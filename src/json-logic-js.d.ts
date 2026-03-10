declare module 'json-logic-js' {
  const jsonLogic: {
    apply: (logic: unknown, data: unknown) => unknown;
    rm_operation: (name: string) => void;
  };
  export default jsonLogic;
}
