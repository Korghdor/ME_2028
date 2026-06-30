import { withSupabase } from "@supabase/server";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/health")) {
      return json({ ok: true, service: "BalticWood ME 2028" });
    }

    if (url.pathname.endsWith("/matches")) {
      const { data, error } = await ctx.supabaseAdmin
        .from("me2028_matches")
        .select("id, number, home_team, away_team, kickoff_at, completed, result_home, result_away")
        .order("number", { ascending: true });

      if (error) {
        return json({ error: error.message }, 500);
      }

      return json(data);
    }

    if (url.pathname.endsWith("/ranking")) {
      const { data, error } = await ctx.supabaseAdmin.rpc("me2028_ranking_json");

      if (error) {
        return json({ error: error.message }, 500);
      }

      return json(data);
    }

    return json({ error: "Not found" }, 404);
  }),
};
