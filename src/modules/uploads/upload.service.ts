import { logger } from "../../config/logger.js";
import {
  LOGO_BUCKET,
  PRODUCT_BUCKET,
  supabase,
} from "../../config/storage.config.js";
import { AppError } from "../../utils/errors.js";


export const UploadService = {
  uploadFile: async (
    file: Express.Multer.File,
    filePath: string,
    imageFor: string,
  ) => {
    let bucket: string = "";
    
    if(imageFor === "logo"){
      bucket  = LOGO_BUCKET
    }
    
    else if(imageFor === "product"){
      bucket  = PRODUCT_BUCKET
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) {
      logger.warn("Supabase Storage Upload Error:", error);
      throw new AppError(`Échec de l'opload du fichier`);
    }
    return data;
  },

  //   Delete file
  deleteFile: async (bucket: string, path: string) => {
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      logger.warn("Supabase Storage Delete Error:", error);
      throw new AppError(`Impossible de supprimer l'image `);
    }

    return data;
  },
};
