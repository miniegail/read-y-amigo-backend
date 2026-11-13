const { notifyClass } = require('../utils/pushNotifications');
const express = require("express");

const Class = require("../models/Class");
const StreamPost = require("../models/StreamPost");
const Enrollment = require("../models/Enrollment");
const PostComment = require("../models/PostComment");

const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// ==========================================
// CHECK CLASS ACCESS
// Teacher of class OR enrolled learner
// ==========================================

async function getAccessibleClass(
  classId,
  userId
) {
  const classDoc = await Class.findOne({
    _id: classId,
    status: "active",
  });

  if (!classDoc) {
    return null;
  }

  // Teacher
  if (
    classDoc.teacher.toString() === userId
  ) {
    return classDoc;
  }

  // Learner
  const enrollment =
    await Enrollment.findOne({
      class: classDoc._id,
      learner: userId,
    });

  if (enrollment) {
    return classDoc;
  }

  return null;
}

// ==========================================
// GET COMMENTS
// ==========================================

router.get(
  "/classes/:classId/posts/:postId",
  async (req, res) => {
    try {
      const classDoc =
        await getAccessibleClass(
          req.params.classId,
          req.userId
        );

      if (!classDoc) {
        return res.status(403).json({
          error:
            "You don't have access to this class.",
        });
      }

      const post =
        await StreamPost.findOne({
          _id: req.params.postId,
          class: classDoc._id,
        });

      if (!post) {
        return res.status(404).json({
          error: "Stream post not found.",
        });
      }

      const comments =
        await PostComment.find({
          post: post._id,
        })
          .populate(
            "author",
            "displayName firstName secondName role"
          )
          .sort({
            createdAt: 1,
          });

      res.json({
        comments,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while loading comments.",
      });
    }
  }
);

// ==========================================
// CREATE COMMENT
// ==========================================

router.post(
  "/classes/:classId/posts/:postId",
  async (req, res) => {
    try {
      const classDoc =
        await getAccessibleClass(
          req.params.classId,
          req.userId
        );

      if (!classDoc) {
        return res.status(403).json({
          error:
            "You don't have access to this class.",
        });
      }

      const post =
        await StreamPost.findOne({
          _id: req.params.postId,
          class: classDoc._id,
        });

      if (!post) {
        return res.status(404).json({
          error: "Stream post not found.",
        });
      }

      const { body } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({
          error: "Comment cannot be empty.",
        });
      }

      const comment =
        await PostComment.create({
          post: post._id,
          class: classDoc._id,
          author: req.userId,
          body: body.trim(),
        });

      await comment.populate(
        "author",
        "displayName firstName secondName role"
      );

      res.status(201).json({
        comment,
      });
      void notifyClass(classDoc._id, "There is a new comment in your class stream.", {
        teacher: classDoc.teacher,
        exclude: req.userId,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while creating the comment.",
      });
    }
  }
);

// ==========================================
// UPDATE OWN COMMENT
// ==========================================

router.patch(
  "/classes/:classId/posts/:postId/:commentId",
  async (req, res) => {
    try {
      const classDoc =
        await getAccessibleClass(
          req.params.classId,
          req.userId
        );

      if (!classDoc) {
        return res.status(403).json({
          error:
            "You don't have access to this class.",
        });
      }

      const comment =
        await PostComment.findOne({
          _id: req.params.commentId,
          post: req.params.postId,
          class: classDoc._id,
        });

      if (!comment) {
        return res.status(404).json({
          error: "Comment not found.",
        });
      }

      if (
        comment.author.toString() !==
        req.userId
      ) {
        return res.status(403).json({
          error:
            "You can only edit your own comment.",
        });
      }

      const { body } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({
          error: "Comment cannot be empty.",
        });
      }

      comment.body = body.trim();

      await comment.save();

      await comment.populate(
        "author",
        "displayName firstName secondName role"
      );

      res.json({
        comment,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while updating the comment.",
      });
    }
  }
);

// ==========================================
// DELETE COMMENT
// Own comment OR teacher
// ==========================================

router.delete(
  "/classes/:classId/posts/:postId/:commentId",
  async (req, res) => {
    try {
      const classDoc =
        await getAccessibleClass(
          req.params.classId,
          req.userId
        );

      if (!classDoc) {
        return res.status(403).json({
          error:
            "You don't have access to this class.",
        });
      }

      const comment =
        await PostComment.findOne({
          _id: req.params.commentId,
          post: req.params.postId,
          class: classDoc._id,
        });

      if (!comment) {
        return res.status(404).json({
          error: "Comment not found.",
        });
      }

      const isAuthor =
        comment.author.toString() ===
        req.userId;

      const isTeacher =
        classDoc.teacher.toString() ===
        req.userId;

      if (!isAuthor && !isTeacher) {
        return res.status(403).json({
          error:
            "You don't have permission to delete this comment.",
        });
      }

      await comment.deleteOne();

      res.json({
        message:
          "Comment deleted successfully.",
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          "Something went wrong while deleting the comment.",
      });
    }
  }
);

module.exports = router;