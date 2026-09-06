const isValidId = (id) => {
  return id !== undefined && id !== null && !isNaN(id) && parseInt(id) > 0;
};

export default isValidId;
