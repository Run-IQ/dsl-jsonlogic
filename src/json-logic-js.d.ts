declare module 'json-logic-js' {
  const jsonLogic: {
    apply: (logic: unknown, data: unknown) => unknown;
  };
  export default jsonLogic;
}
