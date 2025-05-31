// middleware/validation.js - 簡化版本
const validateMessage = (req, res, next) => {
  const { roomId, encryptedContent, contentHash, wrappedDek, dekAuthTag } = req.body;
  
  if (!roomId || !encryptedContent || !contentHash || !wrappedDek || !dekAuthTag) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['roomId', 'encryptedContent', 'contentHash', 'wrappedDek', 'dekAuthTag']
    });
  }
  
  next();
};

const validatePagination = (req, res, next) => {
  const { page = 1, limit = 50 } = req.query;
  
  req.query.page = Math.max(1, parseInt(page));
  req.query.limit = Math.min(100, Math.max(1, parseInt(limit)));
  
  next();
};

module.exports = {
  validateMessage,
  validatePagination
};
