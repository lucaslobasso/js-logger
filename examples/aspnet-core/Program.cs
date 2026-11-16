// Minimal ASP.NET Core receiver for jsLogger (.NET 8+).
//   dotnet run            -> http://localhost:5000/logs
// Each browser event is written through ILogger, so it lands wherever your logging
// already goes (console, Serilog/NLog file sinks, Seq, Application Insights...).

using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:3000") // your site(s)
    .WithMethods("POST")
    .WithHeaders("content-type")));

var app = builder.Build();
app.UseCors();

var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

app.MapPost("/logs", async (HttpRequest request, ILogger<Program> log) =>
{
    // sendBeacon posts as text/plain, so read the body ourselves instead of [FromBody].
    var batch = await JsonSerializer.DeserializeAsync<LogBatch>(request.Body, json);
    if (batch?.Events is null) return Results.BadRequest();

    foreach (var e in batch.Events.Take(100))
    {
        var level = e.Level switch
        {
            "trace" => LogLevel.Trace,
            "debug" => LogLevel.Debug,
            "info" => LogLevel.Information,
            "warn" => LogLevel.Warning,
            "fatal" => LogLevel.Critical,
            _ => LogLevel.Error,
        };
        log.Log(level, "[browser] {Source} {Message} at {Url} [{Fingerprint}]{NewLine}{Stack}",
            e.Source, e.Message, e.Url, e.Fingerprint,
            e.Error?.Stack is null ? "" : Environment.NewLine, e.Error?.Stack ?? "");
    }
    return Results.NoContent();
});

app.Run();

record LogBatch(List<LogEvent> Events);

record LogEvent(
    string Level,
    string Message,
    string Source,
    DateTimeOffset Timestamp,
    string? Url,
    string? UserAgent,
    string? App,
    string? Release,
    JsonElement? User,
    JsonElement? Context,
    SerializedError? Error,
    string Fingerprint);

record SerializedError(string Name, string Message, string? Stack, SerializedError? Cause);
