import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Database } from "./supabase-db.type";
config();

const { SUPABASE_URL = "", SUPABASE_KEY = "" } = process.env;

export const createSupabaseClient = () =>
  createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
