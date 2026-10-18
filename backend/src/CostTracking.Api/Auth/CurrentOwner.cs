using System.Security.Claims;
using System.Text.RegularExpressions;

namespace CostTracking.Api.Auth;

public static class CurrentOwner
{
    /// <summary>Returns only the validated user subject; organization claims never establish ownership.</summary>
    public static string Subject(ClaimsPrincipal principal)
    {
        var subjects = principal.FindAll("sub").ToArray();
        if (principal.Identity?.IsAuthenticated != true || subjects.Length != 1 ||
            !Regex.IsMatch(subjects[0].Value, @"\Auser_[A-Za-z0-9]+\z", RegexOptions.CultureInvariant))
            throw new OwnerAuthenticationException();
        return subjects[0].Value;
    }
}

public sealed class OwnerAuthenticationException() : Exception("A validated user subject is required.");
